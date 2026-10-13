/**
 * Limpeza dos registos expirados de rate limiting:
 * - `api_rate_limit` (domínio): janela fixa; `window_start` em TIMESTAMPTZ;
 * - `rate_limit` (Better Auth): `last_request` em milissegundos desde a época.
 *
 * Apagar uma linha cuja janela já terminou é equivalente a mantê-la: o pedido
 * seguinte recomeçaria a contagem em 1 de qualquer forma. Por isso a retenção tem
 * de ser SEMPRE maior do que a maior janela configurada (validado aqui), e por
 * omissão é de 24 h, bem acima das janelas atuais (60 s a 15 min).
 *
 * Limites de segurança:
 * - lotes de `batchSize` linhas e no máximo `maxBatches` lotes por tabela e execução;
 * - cada lote numa transação curta com `lock_timeout` e `statement_timeout` locais;
 * - `FOR UPDATE SKIP LOCKED`: nunca espera por linhas que um pedido está a atualizar,
 *   e duas execuções em simultâneo (ex.: duas instâncias) não se bloqueiam;
 * - a condição de expiração é verificada outra vez no DELETE.
 * Sem índice em `window_start`/`last_request` (cada lote faz uma leitura sequencial):
 * adequado enquanto as tabelas tiverem poucas dezenas de milhares de linhas.
 */
import { sql } from "drizzle-orm";
import { RATE_LIMIT } from "../auth/auth.ts";
import type { ApiRateLimitConfig } from "../http/rate-limit.ts";
import type { Database } from "./client.ts";

export const DEFAULT_PURGE_RETENTION_S = 24 * 60 * 60;
export const DEFAULT_PURGE_BATCH_SIZE = 1000;
export const DEFAULT_PURGE_MAX_BATCHES = 50;
const MAX_BATCH_SIZE = 10_000;
const MAX_BATCHES = 1000;
const BATCH_LOCK_TIMEOUT = "2s";
const BATCH_STATEMENT_TIMEOUT = "15s";

export interface PurgeOptions {
  readonly now: Date;
  /** Limites do domínio em uso (a retenção tem de exceder a maior janela). */
  readonly apiRateLimit: ApiRateLimitConfig;
  readonly retentionS?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
  /** Só conta as linhas elegíveis; não apaga nada. */
  readonly dryRun?: boolean;
}

export interface TablePurgeResult {
  /** Linhas apagadas (ou elegíveis, em dry run). */
  readonly rows: number;
  readonly batches: number;
  /** `false` quando o limite de lotes foi atingido e ainda podem restar linhas. */
  readonly complete: boolean;
}

export interface PurgeResult {
  readonly cutoff: string;
  readonly api: TablePurgeResult;
  readonly auth: TablePurgeResult;
}

/** Maior janela em vigor (domínio e Better Auth), em segundos. */
export function longestRateLimitWindowS(api: ApiRateLimitConfig): number {
  const authWindows = Object.values(RATE_LIMIT.customRules).map((rule) => rule.window);
  return Math.max(api.read.windowS, api.write.windowS, RATE_LIMIT.window, ...authWindows);
}

function checkedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} tem de ser um inteiro entre ${String(min)} e ${String(max)}.`);
  }
  return value;
}

export async function purgeExpiredRateLimits(db: Database, options: PurgeOptions): Promise<PurgeResult> {
  const longest = longestRateLimitWindowS(options.apiRateLimit);
  const retentionS = options.retentionS ?? DEFAULT_PURGE_RETENTION_S;
  if (!Number.isSafeInteger(retentionS) || retentionS <= longest) {
    throw new RangeError(
      `A retenção (${String(retentionS)} s) tem de ser um inteiro maior do que a maior janela de rate limiting (${String(longest)} s).`,
    );
  }
  const batchSize = checkedInteger("batchSize", options.batchSize ?? DEFAULT_PURGE_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = checkedInteger("maxBatches", options.maxBatches ?? DEFAULT_PURGE_MAX_BATCHES, 1, MAX_BATCHES);
  const cutoffMs = options.now.getTime() - retentionS * 1000;
  if (!Number.isFinite(cutoffMs)) throw new RangeError("Data atual inválida.");
  const cutoff = new Date(cutoffMs).toISOString();

  if (options.dryRun === true) {
    const counts = await db.execute<{ api: string; auth: string }>(sql`
      select
        (select count(*) from api_rate_limit where window_start < ${cutoff}::timestamptz)::text as api,
        (select count(*) from rate_limit where last_request < ${cutoffMs})::text as auth
    `);
    const row = counts.rows[0];
    return {
      cutoff,
      api: { rows: Number(row?.api ?? 0), batches: 0, complete: true },
      auth: { rows: Number(row?.auth ?? 0), batches: 0, complete: true },
    };
  }

  const api = await purgeInBatches(db, batchSize, maxBatches, (limit) => sql`
    with doomed as (
      select key from api_rate_limit
      where window_start < ${cutoff}::timestamptz
      order by window_start
      limit ${limit}
      for update skip locked
    )
    delete from api_rate_limit as target using doomed
    where target.key = doomed.key and target.window_start < ${cutoff}::timestamptz
  `);
  const auth = await purgeInBatches(db, batchSize, maxBatches, (limit) => sql`
    with doomed as (
      select id from rate_limit
      where last_request < ${cutoffMs}
      order by last_request
      limit ${limit}
      for update skip locked
    )
    delete from rate_limit as target using doomed
    where target.id = doomed.id and target.last_request < ${cutoffMs}
  `);
  return { cutoff, api, auth };
}

async function purgeInBatches(
  db: Database,
  batchSize: number,
  maxBatches: number,
  deleteBatch: (limit: number) => ReturnType<typeof sql>,
): Promise<TablePurgeResult> {
  let rows = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = '${BATCH_LOCK_TIMEOUT}'`));
      await tx.execute(sql.raw(`set local statement_timeout = '${BATCH_STATEMENT_TIMEOUT}'`));
      const result = await tx.execute(deleteBatch(batchSize));
      return result.rowCount ?? 0;
    });
    rows += deleted;
    if (deleted < batchSize) return { rows, batches: batch, complete: true };
  }
  return { rows, batches: maxBatches, complete: false };
}

export interface PurgeSchedulerOptions {
  readonly db: Database;
  readonly apiRateLimit: ApiRateLimitConfig;
  readonly intervalS: number;
  readonly logger: Pick<Console, "info" | "error">;
  readonly clock?: () => Date;
}

/**
 * Execução periódica dentro do processo da API (uma instância: suficiente; várias:
 * seguro por SKIP LOCKED). O primeiro ciclo corre após um intervalo, nunca no
 * arranque; ciclos não se sobrepõem; os timers não impedem o processo de terminar.
 * Devolve `stop()`, que espera pelo ciclo em curso.
 */
export function startRateLimitPurge(options: PurgeSchedulerOptions): () => Promise<void> {
  const clock = options.clock ?? (() => new Date());
  let running: Promise<void> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || running) return;
    running = purgeExpiredRateLimits(options.db, { now: clock(), apiRateLimit: options.apiRateLimit })
      .then((result) => {
        if (result.api.rows + result.auth.rows > 0 || !result.api.complete || !result.auth.complete) {
          options.logger.info(
            `Rate limiting: ${String(result.api.rows)} registos de domínio e ${String(result.auth.rows)} de autenticação apagados (anteriores a ${result.cutoff}).`,
          );
        }
      })
      .catch((error: unknown) => {
        options.logger.error("Falha na limpeza de rate limiting:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, options.intervalS * 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

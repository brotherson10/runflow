import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { sendProblem } from "../problem.ts";

export interface RateLimitRule {
  /** Duração da janela fixa, em segundos. */
  readonly windowS: number;
  /** Pedidos permitidos por janela. */
  readonly max: number;
}

export interface ApiRateLimitConfig {
  readonly read: RateLimitRule;
  readonly write: RateLimitRule;
}

export const DEFAULT_API_RATE_LIMIT: ApiRateLimitConfig = {
  read: { windowS: 60, max: 120 },
  write: { windowS: 60, max: 30 },
};

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly count: number;
  /** Segundos até a janela atual terminar (só relevante quando bloqueado). */
  readonly retryAfterS: number;
}

/**
 * Janela fixa por chave, guardada em `api_rate_limit`. A contagem e a renovação
 * da janela acontecem num único INSERT ... ON CONFLICT (atómico sob concorrência).
 */
export async function consumeRateLimit(
  db: Database,
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<RateLimitDecision> {
  const windowMs = rule.windowS * 1000;
  const expiredBefore = new Date(now.getTime() - windowMs);
  const result = await db.execute<{ count: number; window_start_ms: string }>(sql`
    insert into api_rate_limit (key, window_start, count)
    values (${key}, ${now.toISOString()}::timestamptz, 1)
    on conflict (key) do update set
      window_start = case when api_rate_limit.window_start <= ${expiredBefore.toISOString()}::timestamptz
                          then excluded.window_start else api_rate_limit.window_start end,
      count = case when api_rate_limit.window_start <= ${expiredBefore.toISOString()}::timestamptz
                   then 1 else api_rate_limit.count + 1 end
    returning count, (extract(epoch from window_start) * 1000)::bigint::text as window_start_ms
  `);
  const row = result.rows[0];
  const count = row?.count ?? 1;
  const windowStart = row ? Number(row.window_start_ms) : now.getTime();
  const retryAfterS = Math.max(1, Math.ceil((windowStart + windowMs - now.getTime()) / 1000));
  return { allowed: count <= rule.max, count, retryAfterS };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rate limiting das rotas de domínio, por IP do cliente (`req.ip`, que segue a
 * mesma estratégia `trust proxy` usada para o Better Auth) e por tipo de pedido.
 * Em 429 envia o cabeçalho padrão `Retry-After` (segundos).
 */
export function apiRateLimit(
  db: Database,
  config: ApiRateLimitConfig,
  clock: () => Date,
  bucket: string,
): RequestHandler {
  return async (req, res, next) => {
    const kind = SAFE_METHODS.has(req.method) ? "read" : "write";
    const rule = config[kind];
    const ip = req.ip ?? "unknown";
    const decision = await consumeRateLimit(db, `${bucket}:${kind}|${ip}`, rule, clock());
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterS));
      sendProblem(res, 429, "RATE_LIMITED", "Demasiados pedidos. Tente novamente mais tarde.");
      return;
    }
    next();
  };
}

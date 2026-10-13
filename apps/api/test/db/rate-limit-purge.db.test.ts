import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  DEFAULT_PURGE_RETENTION_S,
  longestRateLimitWindowS,
  purgeExpiredRateLimits,
  startRateLimitPurge,
} from "../../src/db/rate-limit-purge.ts";
import { DEFAULT_API_RATE_LIMIT } from "../../src/http/rate-limit.ts";
import { AUTH, startAuthServer, TestClient } from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const RETENTION_MS = DEFAULT_PURGE_RETENTION_S * 1000;
const EXPIRED_MS = NOW.getTime() - RETENTION_MS - 1000;
const FRESH_MS = NOW.getTime() - RETENTION_MS + 60_000;
const base = { apiRateLimit: DEFAULT_API_RATE_LIMIT } as const;

async function counts(handle: DatabaseHandle): Promise<{ api: number; auth: number }> {
  const { rows } = await handle.db.execute<{ api: number; auth: number }>(sql`
    select (select count(*) from api_rate_limit)::int as api, (select count(*) from rate_limit)::int as auth
  `);
  return { api: rows[0]?.api ?? -1, auth: rows[0]?.auth ?? -1 };
}

async function seed(handle: DatabaseHandle, prefix: string, n: number, atMs: number): Promise<void> {
  const at = new Date(atMs).toISOString();
  await handle.db.execute(sql`
    insert into api_rate_limit (key, window_start, count)
    select ${prefix} || g, ${at}::timestamptz, 1 from generate_series(1, ${n}) as g
  `);
  await handle.db.execute(sql`
    insert into rate_limit (id, key, count, last_request)
    select ${prefix} || g, ${prefix} || g, 1, ${atMs}::bigint from generate_series(1, ${n}) as g
  `);
}

describe("limpeza de registos expirados de rate limiting", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`delete from api_rate_limit`);
    await handle.db.execute(sql`delete from rate_limit`);
  });

  it("registos criados por pedidos reais sobrevivem agora e só são apagados após a retenção", async () => {
    const server = await startAuthServer(handle);
    try {
      const client = new TestClient(server.baseUrl);
      await client.post(`${AUTH}/sign-in/email`, { email: "ninguem@example.test", password: "palavra-errada-123" });
      await client.get("/api/v1/workouts");
    } finally {
      await server.close();
    }
    expect(await counts(handle)).toEqual({ api: 1, auth: 1 });

    // Better Auth guarda `last_request` em ms: com a hora real nada é elegível.
    const now = new Date();
    const kept = await purgeExpiredRateLimits(handle.db, { ...base, now });
    expect([kept.api.rows, kept.auth.rows]).toEqual([0, 0]);
    expect(await counts(handle)).toEqual({ api: 1, auth: 1 });

    const later = new Date(now.getTime() + RETENTION_MS + 2000);
    const purged = await purgeExpiredRateLimits(handle.db, { ...base, now: later });
    expect([purged.api.rows, purged.auth.rows]).toEqual([1, 1]);
    expect(await counts(handle)).toEqual({ api: 0, auth: 0 });
  });

  it("apaga em lotes limitados, só linhas expiradas, e continua na execução seguinte", async () => {
    await seed(handle, "old-", 25, EXPIRED_MS);
    await seed(handle, "new-", 3, FRESH_MS);

    const first = await purgeExpiredRateLimits(handle.db, { ...base, now: NOW, batchSize: 10, maxBatches: 2 });
    expect(first.api).toEqual({ rows: 20, batches: 2, complete: false });
    expect(first.auth).toEqual({ rows: 20, batches: 2, complete: false });
    expect(first.cutoff).toBe(new Date(NOW.getTime() - RETENTION_MS).toISOString());

    const second = await purgeExpiredRateLimits(handle.db, { ...base, now: NOW, batchSize: 10, maxBatches: 2 });
    expect(second.api).toEqual({ rows: 5, batches: 1, complete: true });
    expect(second.auth).toEqual({ rows: 5, batches: 1, complete: true });

    expect(await counts(handle)).toEqual({ api: 3, auth: 3 });
    const { rows } = await handle.db.execute<{ key: string }>(sql`select key from api_rate_limit order by key`);
    expect(rows.map((row) => row.key)).toEqual(["new-1", "new-2", "new-3"]);
  });

  it("dry run conta sem apagar", async () => {
    await seed(handle, "old-", 4, EXPIRED_MS);
    await seed(handle, "new-", 2, FRESH_MS);
    const result = await purgeExpiredRateLimits(handle.db, { ...base, now: NOW, dryRun: true });
    expect([result.api.rows, result.auth.rows]).toEqual([4, 4]);
    expect(await counts(handle)).toEqual({ api: 6, auth: 6 });
  });

  it("recusa retenção que não exceda a maior janela e limites de lote inválidos, sem apagar nada", async () => {
    await seed(handle, "old-", 2, EXPIRED_MS);
    const longest = longestRateLimitWindowS(DEFAULT_API_RATE_LIMIT);
    expect(longest).toBe(15 * 60);
    const longerApi = { read: { windowS: 7200, max: 1 }, write: { windowS: 60, max: 1 } };
    expect(longestRateLimitWindowS(longerApi)).toBe(7200);

    for (const options of [
      { retentionS: longest },
      { retentionS: 60 },
      { retentionS: 0 },
      { retentionS: 1.5 * 3600 + 0.5 },
      { batchSize: 0 },
      { batchSize: 10_001 },
      { maxBatches: 0 },
      { maxBatches: 1.5 },
    ]) {
      await expect(purgeExpiredRateLimits(handle.db, { ...base, now: NOW, ...options })).rejects.toThrow(RangeError);
    }
    await expect(
      purgeExpiredRateLimits(handle.db, { apiRateLimit: longerApi, now: NOW, retentionS: 3600 }),
    ).rejects.toThrow(RangeError);
    await expect(purgeExpiredRateLimits(handle.db, { ...base, now: new Date(Number.NaN) })).rejects.toThrow(RangeError);
    expect(await counts(handle)).toEqual({ api: 2, auth: 2 });
  });

  it("não espera por linhas bloqueadas por outro pedido (SKIP LOCKED) e não as apaga", async () => {
    await seed(handle, "old-", 3, EXPIRED_MS);
    const holder = await handle.pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select key from api_rate_limit where key = 'old-1' for update");
      await holder.query("select id from rate_limit where id = 'old-1' for update");

      const started = Date.now();
      const result = await purgeExpiredRateLimits(handle.db, { ...base, now: NOW });
      expect(Date.now() - started).toBeLessThan(2000);
      expect([result.api.rows, result.auth.rows]).toEqual([2, 2]);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    expect(await counts(handle)).toEqual({ api: 1, auth: 1 });
  });

  it("agendador: corre por intervalo, sem sobreposição, e stop() espera pelo ciclo em curso", async () => {
    await seed(handle, "old-", 3, EXPIRED_MS);
    const logs: string[] = [];
    const errors: unknown[] = [];
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const stop = startRateLimitPurge({
        db: handle.db,
        apiRateLimit: DEFAULT_API_RATE_LIMIT,
        intervalS: 60,
        clock: () => NOW,
        logger: { info: (message: string) => logs.push(message), error: (...args: unknown[]) => errors.push(args) },
      });
      expect(await counts(handle)).toEqual({ api: 3, auth: 3 });
      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000); // ciclo ainda em curso: ignorado
      await stop();
      vi.advanceTimersByTime(600_000); // depois de stop() não volta a correr
    } finally {
      vi.useRealTimers();
    }
    expect(errors).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("3 registos de domínio e 3 de autenticação");
    expect(await counts(handle)).toEqual({ api: 0, auth: 0 });
  });
});

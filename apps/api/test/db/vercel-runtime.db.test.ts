import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { DEFAULT_PURGE_RETENTION_S } from "../../src/db/rate-limit-purge.ts";
import { CRON_PURGE_PATH } from "../../src/http/cron.ts";
import { DEFAULT_API_RATE_LIMIT } from "../../src/http/rate-limit.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const SECRET = "segredo-do-cron-de-teste-com-mais-de-32-caracteres";
const NOW = new Date("2026-10-13T12:00:00.000Z");

async function seed(handle: DatabaseHandle, expired: number, fresh: number): Promise<void> {
  const old = new Date(NOW.getTime() - (DEFAULT_PURGE_RETENTION_S + 60) * 1000);
  await handle.db.execute(sql`
    insert into api_rate_limit (key, window_start, count)
    select 'velho-' || g, ${old.toISOString()}::timestamptz, 1 from generate_series(1, ${expired}) as g
    union all
    select 'novo-' || g, ${NOW.toISOString()}::timestamptz, 1 from generate_series(1, ${fresh}) as g
  `);
  await handle.db.execute(sql`
    insert into rate_limit (id, key, count, last_request)
    select 'velho-' || g, 'velho-' || g, 1, ${old.getTime()}::bigint from generate_series(1, ${expired}) as g
  `);
}

async function remaining(handle: DatabaseHandle): Promise<{ api: number; auth: number }> {
  const { rows } = await handle.db.execute<{ api: number; auth: number }>(sql`
    select (select count(*) from api_rate_limit)::int as api, (select count(*) from rate_limit)::int as auth
  `);
  return { api: rows[0]?.api ?? -1, auth: rows[0]?.auth ?? -1 };
}

describe("Vercel Cron: limpeza de rate limiting por rota autenticada", () => {
  let handle: DatabaseHandle;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    const app = createApp({
      logger: { error: () => undefined },
      cron: { secret: SECRET, db: handle.db, apiRateLimit: DEFAULT_API_RATE_LIMIT, clock: () => NOW },
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    await handle.close();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`delete from api_rate_limit`);
    await handle.db.execute(sql`delete from rate_limit`);
  });

  it.each([
    ["sem Authorization", {}],
    ["segredo errado", { Authorization: `Bearer ${SECRET}x` }],
    ["sem Bearer", { Authorization: SECRET }],
  ])("%s → 401 e nada é apagado", async (_label, headers) => {
    await seed(handle, 3, 1);
    const res = await fetch(`${baseUrl}${CRON_PURGE_PATH}`, { headers });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/problem\+json/);
    expect(await remaining(handle)).toEqual({ api: 4, auth: 3 });
  });

  it("POST → 405 (a Vercel invoca com GET)", async () => {
    const res = await fetch(`${baseUrl}${CRON_PURGE_PATH}`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(405);
  });

  it("autorizado: apaga só os expirados, devolve só contagens e repetir é inofensivo", async () => {
    await seed(handle, 5, 2);
    const auth = { Authorization: `Bearer ${SECRET}` };
    const first = await fetch(`${baseUrl}${CRON_PURGE_PATH}`, { headers: auth });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const body = (await first.json()) as { api: { rows: number; complete: boolean }; auth: { rows: number } };
    expect(body.api).toMatchObject({ rows: 5, complete: true });
    expect(body.auth).toMatchObject({ rows: 5 });
    expect(JSON.stringify(body)).not.toMatch(/velho-|novo-/);
    expect(await remaining(handle)).toEqual({ api: 2, auth: 0 });

    const second = (await (await fetch(`${baseUrl}${CRON_PURGE_PATH}`, { headers: auth })).json()) as {
      api: { rows: number };
      auth: { rows: number };
    };
    expect([second.api.rows, second.auth.rows]).toEqual([0, 0]);
  });

  it("duas invocações em simultâneo (entrega duplicada): sem erro e sem apagar a mais", async () => {
    await seed(handle, 50, 3);
    const auth = { Authorization: `Bearer ${SECRET}` };
    const responses = await Promise.all([
      fetch(`${baseUrl}${CRON_PURGE_PATH}`, { headers: auth }),
      fetch(`${baseUrl}${CRON_PURGE_PATH}`, { headers: auth }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as { api: { rows: number } }[];
    expect(bodies.reduce((sum, b) => sum + b.api.rows, 0)).toBe(50);
    expect(await remaining(handle)).toEqual({ api: 3, auth: 0 });
  });
});


import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SESSION_EXPIRES_IN_S } from "../../src/auth/auth.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  AUTH,
  signedInClient,
  startAuthServer,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

// Evidência de runtime: o adapter Drizzle do Better Auth funciona com as colunas
// convertidas para TIMESTAMPTZ na fase 3B, mesmo com o fuso do processo a mudar.

describe("Better Auth com TIMESTAMPTZ", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  const originalTz = process.env["TZ"];

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle);
  });

  afterEach(() => {
    if (originalTz === undefined) delete process.env["TZ"];
    else process.env["TZ"] = originalTz;
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("as colunas de instante das tabelas de autenticação são timestamptz", async () => {
    const { rows } = await handle.pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('user', 'session', 'account', 'verification')
          and data_type like 'timestamp%'`,
    );
    expect(rows.length).toBe(12);
    expect(new Set(rows.map((row) => row.data_type))).toEqual(new Set(["timestamp with time zone"]));
  });

  it("o adapter não reporta divergência de schema ao arrancar", () => {
    expect(server.logger.text()).not.toMatch(/schema mismatch/i);
  });

  it("expiração da sessão persiste o mesmo instante com o processo em UTC+14 e UTC-7", async () => {
    process.env["TZ"] = "Pacific/Kiritimati";
    const before = Date.now();
    const { client } = await signedInClient(server);
    const after = Date.now();

    const { rows } = await handle.pool.query<{ epoch: string; iso: string }>(
      `select extract(epoch from s.expires_at)::text as epoch,
              to_char(s.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso
         from session s order by s.created_at desc limit 1`,
    );
    const expiresMs = Number(rows[0]?.epoch) * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + SESSION_EXPIRES_IN_S * 1000 - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + SESSION_EXPIRES_IN_S * 1000 + 1000);

    // Com outro fuso no processo, a sessão continua válida e o instante é o mesmo.
    process.env["TZ"] = "America/Los_Angeles";
    const session = await client.get<{ session: { expiresAt: string } }>(`${AUTH}/get-session`);
    expect(session.status).toBe(200);
    expect(new Date(session.body.session.expiresAt).toISOString()).toBe(rows[0]?.iso);
    expect((await client.get("/api/v1/me")).status).toBe(200);
  });

  it("createdAt do utilizador é um instante correto, independente do TZ do processo", async () => {
    process.env["TZ"] = "America/Los_Angeles";
    const before = Date.now();
    const { input } = await signedInClient(server);
    const after = Date.now();

    process.env["TZ"] = "Pacific/Kiritimati";
    const { rows } = await handle.pool.query<{ created: string }>(
      `select extract(epoch from u.created_at)::text as created from "user" u where u.email = $1`,
      [input.email],
    );
    const created = Number(rows[0]?.created) * 1000;
    expect(created).toBeGreaterThanOrEqual(before - 1000);
    expect(created).toBeLessThanOrEqual(after + 1000);
  });

  it("uma sessão expirada na base (TIMESTAMPTZ no passado) deixa de ser aceite", async () => {
    const { client, userId } = await signedInClient(server);
    await handle.pool.query(
      "update session set expires_at = now() - interval '1 second' where user_id = $1",
      [userId],
    );
    expect((await client.get("/api/v1/me")).status).toBe(401);
  });
});

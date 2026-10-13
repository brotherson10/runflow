import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RATE_LIMIT } from "../../src/auth/auth.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  AUTH,
  nextClientIp,
  startAuthServer,
  TestClient,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const SIGN_IN_MAX = RATE_LIMIT.customRules["/sign-in/email"].max;
const RESET_MAX = RATE_LIMIT.customRules["/request-password-reset"].max;
const badLogin = { email: "ninguem@example.test", password: "palavra-errada-123" };

async function exhaustSignIn(client: TestClient): Promise<number[]> {
  const statuses: number[] = [];
  for (let attempt = 0; attempt <= SIGN_IN_MAX; attempt++) {
    statuses.push((await client.post(`${AUTH}/sign-in/email`, badLogin)).status);
  }
  return statuses;
}

describe("rate limiting persistente (HTTP + PostgreSQL)", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("sem proxy confiável (padrão: trust proxy = false)", () => {
    let server: AuthTestServer;

    beforeAll(async () => {
      server = await startAuthServer(handle, { trustProxy: false });
    });

    afterAll(async () => {
      await server.close();
    });

    it(`login: ${String(SIGN_IN_MAX)} tentativas e depois 429`, async () => {
      const statuses = await exhaustSignIn(new TestClient(server.baseUrl, { forwardedFor: null }));
      expect(statuses.slice(0, SIGN_IN_MAX)).toEqual(Array(SIGN_IN_MAX).fill(401));
      expect(statuses.at(-1)).toBe(429);
    });

    it("X-Forwarded-For e o cabeçalho interno enviados pelo cliente não contornam o limite", async () => {
      // O bucket do IP do socket (127.0.0.1) já está esgotado pelo teste anterior.
      for (const spoofed of ["203.0.113.1", "203.0.113.2", "198.51.100.7"]) {
        const client = new TestClient(server.baseUrl, { forwardedFor: spoofed });
        const res = await client.post(`${AUTH}/sign-in/email`, badLogin, {
          "X-Runflow-Client-Ip": spoofed,
        });
        expect(res.status).toBe(429);
        expect(res.headers.get("x-retry-after")).toMatch(/^\d+$/);
      }
    });
  });

  describe("com proxy de loopback confiável", () => {
    let server: AuthTestServer;

    beforeAll(async () => {
      server = await startAuthServer(handle, { trustProxy: "loopback" });
    });

    afterAll(async () => {
      await server.close();
    });

    it("cada cliente (IP encaminhado pelo proxy confiável) tem o seu próprio limite", async () => {
      const first = await exhaustSignIn(new TestClient(server.baseUrl, { forwardedFor: nextClientIp() }));
      expect(first.at(-1)).toBe(429);
      const other = new TestClient(server.baseUrl, { forwardedFor: nextClientIp() });
      expect((await other.post(`${AUTH}/sign-in/email`, badLogin)).status).toBe(401);
    });

    it(`recuperação: ${String(RESET_MAX)} pedidos e depois 429`, async () => {
      const client = new TestClient(server.baseUrl);
      const statuses: number[] = [];
      for (let attempt = 0; attempt <= RESET_MAX; attempt++) {
        statuses.push(
          (await client.post(`${AUTH}/request-password-reset`, { email: "x@example.test" })).status,
        );
      }
      expect(statuses.slice(0, RESET_MAX)).toEqual(Array(RESET_MAX).fill(200));
      expect(statuses.at(-1)).toBe(429);
    });

    it("o estado do limite fica na base de dados e sobrevive a um reinício da API", async () => {
      const ip = nextClientIp();
      await exhaustSignIn(new TestClient(server.baseUrl, { forwardedFor: ip }));
      const { rows } = await handle.pool.query<{ key: string; count: number }>(
        "select key, count from rate_limit where key = $1",
        [`${ip}|/sign-in/email`],
      );
      expect(rows).toHaveLength(1);

      const restarted = await startAuthServer(handle, { trustProxy: "loopback" });
      try {
        const res = await new TestClient(restarted.baseUrl, { forwardedFor: ip }).post(
          `${AUTH}/sign-in/email`,
          badLogin,
        );
        expect(res.status).toBe(429);
      } finally {
        await restarted.close();
      }
    });
  });
});

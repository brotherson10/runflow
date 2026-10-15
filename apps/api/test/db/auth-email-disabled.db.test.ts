import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL_FEATURES_UNAVAILABLE_MESSAGE } from "../../src/auth/http.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { AUTH, newUserInput, signedInClient, startAuthServer, TestClient, type AuthTestServer } from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

interface Problem {
  status: number;
  code: string;
  detail?: string;
}

/** Projeto demonstrativo sem e-mail (D52). */
describe("sem e-mail: sem confirmação nem recuperação (HTTP + PostgreSQL)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle);
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("registo e login imediato; o e-mail fica por verificar (nunca marcado artificialmente)", async () => {
    const { client, input, userId } = await signedInClient(server);
    expect((await client.get("/api/v1/me")).status).toBe(200);
    const { rows } = await handle.pool.query<{ email_verified: boolean }>(
      `select email_verified from "user" where id = $1`,
      [userId],
    );
    expect(rows[0]?.email_verified).toBe(false);
    expect(input.email).toContain("@");
  });

  it.each([
    ["POST", "/request-password-reset", { email: "alguem@example.test" }],
    ["POST", "/reset-password", { token: "abcdefghijklmnopqrstuvwx", newPassword: "uma-frase-comprida-qualquer" }],
    ["GET", "/reset-password/abcdefghijklmnopqrstuvwx?callbackURL=%2F", undefined],
    ["POST", "/send-verification-email", { email: "alguem@example.test" }],
    ["GET", "/verify-email?token=a.b.c", undefined],
    ["POST", "/change-email", { newEmail: "novo@example.test" }],
    ["POST", "/REQUEST-PASSWORD-RESET", { email: "alguem@example.test" }],
  ])("%s %s → 410 FEATURE_UNAVAILABLE com motivo claro", async (method, path, body) => {
    const client = new TestClient(server.baseUrl);
    const res = method === "GET" ? await client.get<Problem>(`${AUTH}${path}`) : await client.post<Problem>(`${AUTH}${path}`, body);
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toMatch(/problem\+json/);
    expect(res.body.code).toBe("FEATURE_UNAVAILABLE");
    expect(res.body.detail).toBe(EMAIL_FEATURES_UNAVAILABLE_MESSAGE);
  });

  it("pedir recuperação para uma conta existente não cria tokens", async () => {
    const { input } = await signedInClient(server);
    const res = await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, { email: input.email });
    expect(res.status).toBe(410);
    const { rowCount } = await handle.pool.query(`select 1 from verification`);
    expect(rowCount).toBe(0);
  });

  it("o resto da autenticação continua: registo duplicado neutro, palavra-passe errada 401", async () => {
    const first = newUserInput();
    const fresh = await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, first);
    const duplicate = await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, {
      ...first,
      password: "outra-palavra-passe-diferente",
    });
    expect([fresh.status, duplicate.status]).toEqual([200, 200]);
    const wrong = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
      email: first.email,
      password: "outra-palavra-passe-diferente",
    });
    expect(wrong.status).toBe(401);
  });
});

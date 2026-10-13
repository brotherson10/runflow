import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESET_TOKEN_EXPIRES_IN_S } from "../../src/auth/auth.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  AUTH,
  flushBackground,
  signedInClient,
  startAuthServer,
  TEST_APP_ORIGIN,
  TestClient,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const NEW_PASSWORD = "nova-palavra-passe-segura-2";

describe("recuperação e redefinição de palavra-passe (HTTP + PostgreSQL)", () => {
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

  /** Pede a recuperação e devolve o token do e-mail capturado localmente. */
  async function requestToken(email: string): Promise<string> {
    const res = await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, {
      email,
    });
    expect(res.status).toBe(200);
    await flushBackground();
    const message = server.mailbox.find(email, "password-reset").at(-1);
    if (!message) throw new Error("Nenhum e-mail de recuperação capturado.");
    const link = /https?:\/\/\S+/.exec(message.text)?.[0] ?? "";
    const token = new URL(link).searchParams.get("token");
    if (!token) throw new Error("Link de recuperação sem token.");
    return token;
  }

  it("resposta pública neutra para conta existente e inexistente", async () => {
    const { input } = await signedInClient(server);
    const existing = await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, {
      email: input.email,
    });
    const missing = await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, {
      email: "nao.existe@example.test",
    });
    expect(existing.status).toBe(200);
    expect(missing.status).toBe(existing.status);
    expect(missing.text).toBe(existing.text);
    expect(missing.headers.getSetCookie()).toEqual(existing.headers.getSetCookie());

    await flushBackground();
    expect(server.mailbox.find(input.email, "password-reset")).toHaveLength(1);
    expect(server.mailbox.find("nao.existe@example.test", "password-reset")).toHaveLength(0);
  });

  it("o link usa a origem configurada e o token expira em 30 minutos (TIMESTAMPTZ)", async () => {
    const { input, userId } = await signedInClient(server);
    const before = Date.now();
    const token = await requestToken(input.email);
    const message = server.mailbox.find(input.email, "password-reset").at(-1);
    expect(message?.text).toContain(`${TEST_APP_ORIGIN}/redefinir-senha?token=${token}`);

    const { rows } = await handle.pool.query<{ expires_at: Date; value: string; type: string }>(
      `select v.expires_at, v.value, pg_typeof(v.expires_at)::text as type
         from verification v where v.identifier = $1`,
      [`reset-password:${token}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("timestamp with time zone");
    expect(rows[0]?.value).toBe(userId);
    const expiresInMs = (rows[0]?.expires_at.getTime() ?? 0) - before;
    expect(RESET_TOKEN_EXPIRES_IN_S).toBeLessThanOrEqual(60 * 60);
    expect(expiresInMs).toBeGreaterThan(RESET_TOKEN_EXPIRES_IN_S * 1000 - 60_000);
    expect(expiresInMs).toBeLessThanOrEqual(RESET_TOKEN_EXPIRES_IN_S * 1000 + 60_000);
  });

  it("redefinição: revoga sessões, não inicia sessão e o token é de uso único", async () => {
    const { client: deviceA, input } = await signedInClient(server);
    const deviceB = new TestClient(server.baseUrl);
    expect(
      (await deviceB.post(`${AUTH}/sign-in/email`, { email: input.email, password: input.password }))
        .status,
    ).toBe(200);
    const token = await requestToken(input.email);

    const reset = await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
      token,
      newPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ status: true });
    // Sem login automático: nenhum cookie de sessão na resposta.
    expect(reset.headers.getSetCookie().filter((c) => c.includes("session_token="))).toEqual([]);

    // Todas as sessões anteriores foram revogadas.
    expect((await deviceA.get("/api/v1/me")).status).toBe(401);
    expect((await deviceB.get("/api/v1/me")).status).toBe(401);
    const { rowCount } = await handle.pool.query(
      `select 1 from session s join "user" u on u.id = s.user_id where u.email = $1`,
      [input.email],
    );
    expect(rowCount).toBe(0);

    // Palavra-passe antiga deixa de funcionar; a nova funciona.
    const oldLogin = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: input.password,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: NEW_PASSWORD,
    });
    expect(newLogin.status).toBe(200);

    // Reutilizar o mesmo token falha.
    const reuse = await new TestClient(server.baseUrl).post<{ code: string }>(
      `${AUTH}/reset-password`,
      { token, newPassword: "outra-palavra-passe-3" },
    );
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe("INVALID_TOKEN");

    await flushBackground();
    expect(server.mailbox.find(input.email, "password-changed")).toHaveLength(1);
  });

  it("token inválido é recusado", async () => {
    const res = await new TestClient(server.baseUrl).post<{ code: string }>(
      `${AUTH}/reset-password`,
      { token: "token-inventado", newPassword: NEW_PASSWORD },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("token expirado é recusado e removido", async () => {
    const { input } = await signedInClient(server);
    const token = await requestToken(input.email);
    await handle.pool.query(
      `update verification set expires_at = now() - interval '1 minute' where identifier = $1`,
      [`reset-password:${token}`],
    );
    const res = await new TestClient(server.baseUrl).post<{ code: string }>(
      `${AUTH}/reset-password`,
      { token, newPassword: NEW_PASSWORD },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOKEN");
    const { rowCount } = await handle.pool.query(`select 1 from verification where identifier = $1`, [
      `reset-password:${token}`,
    ]);
    expect(rowCount).toBe(0);
    // A palavra-passe original mantém-se.
    const login = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: input.password,
    });
    expect(login.status).toBe(200);
  });

  it("palavra-passe nova inválida não consome o token", async () => {
    const { input } = await signedInClient(server);
    const token = await requestToken(input.email);
    const short = await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
      token,
      newPassword: "curta",
    });
    expect(short.status).toBe(400);
    const valid = await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
      token,
      newPassword: NEW_PASSWORD,
    });
    expect(valid.status).toBe(200);
  });

  it("tokens e links de recuperação não aparecem nos logs", async () => {
    const { input } = await signedInClient(server);
    const token = await requestToken(input.email);
    await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
      token,
      newPassword: NEW_PASSWORD,
    });
    await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
      token,
      newPassword: NEW_PASSWORD,
    });
    const logs = server.logger.text();
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("redefinir-senha");
    expect(logs).not.toContain("reset-password:");
  });
});

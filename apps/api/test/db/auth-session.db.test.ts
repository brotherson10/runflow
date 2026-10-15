import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  AUTH,
  newUserInput,
  SESSION_COOKIE,
  signedInClient,
  startAuthServer,
  TestClient,
  UNTRUSTED_ORIGIN,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

interface SignUpBody {
  token: string | null;
  user: Record<string, unknown> & { id: string; name: string; timeZone: string };
}

describe("registo, login, sessão, /me e logout (HTTP + PostgreSQL)", () => {
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

  describe("registo", () => {
    it("cria o utilizador sem iniciar sessão e sem expor a palavra-passe", async () => {
      const client = new TestClient(server.baseUrl);
      const input = newUserInput({ name: "  Ana Corredora  ", timeZone: "Atlantic/Azores" });
      const res = await client.post<SignUpBody>(`${AUTH}/sign-up/email`, input);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeNull();
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(res.body.user).toMatchObject({
        name: "Ana Corredora",
        email: input.email,
        emailVerified: false,
        image: null,
        timeZone: "Atlantic/Azores",
      });
      expect(typeof res.body.user.id).toBe("string");
      expect(res.text).not.toContain(input.password);

      const { rows } = await handle.pool.query<{ password: string; time_zone: string }>(
        `select a.password, u.time_zone from "user" u join account a on a.user_id = u.id
          where u.email = $1 and a.provider_id = 'credential'`,
        [input.email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.time_zone).toBe("Atlantic/Azores");
      expect(rows[0]?.password).not.toContain(input.password);
      expect(rows[0]?.password.length).toBeGreaterThan(input.password.length);
    });

    it.each([
      ["nome em falta", { name: undefined }, "INVALID_NAME"],
      ["nome só com espaços", { name: "   " }, "INVALID_NAME"],
      ["nome com 61 caracteres", { name: "a".repeat(61) }, "INVALID_NAME"],
      ["nome com quebra de linha", { name: "Ana\nCorredora" }, "INVALID_NAME"],
      ["nome que não é texto", { name: 42 }, "INVALID_NAME"],
      ["fuso em falta", { timeZone: undefined }, "INVALID_TIME_ZONE"],
      ["fuso inexistente", { timeZone: "Marte/Base" }, "INVALID_TIME_ZONE"],
      ["desvio em vez de fuso IANA", { timeZone: "+01:00" }, "INVALID_TIME_ZONE"],
      ["imagem enviada pelo cliente", { image: "https://evil.example/x.png" }, "FIELD_NOT_ALLOWED"],
      ["palavra-passe com 14 caracteres", { password: "abcdefghijklmn" }, "PASSWORD_TOO_SHORT"],
      ["palavra-passe com 129 caracteres", { password: "x".repeat(129) }, "PASSWORD_TOO_LONG"],
      ["e-mail inválido", { email: "nao-e-email" }, undefined],
    ])("rejeita %s", async (_label, override, code) => {
      const client = new TestClient(server.baseUrl);
      const input: Record<string, unknown> = { ...newUserInput(), ...override };
      const res = await client.post<{ code?: string }>(`${AUTH}/sign-up/email`, input);
      expect(res.status).toBe(400);
      if (code) expect(res.body.code).toBe(code);
      const { rowCount } = await handle.pool.query(`select 1 from "user" where email = $1`, [
        input["email"],
      ]);
      expect(rowCount).toBe(0);
    });

    it("ignora campos internos enviados pelo cliente (id, emailVerified, createdAt)", async () => {
      const client = new TestClient(server.baseUrl);
      const input = newUserInput();
      const res = await client.post<SignUpBody>(`${AUTH}/sign-up/email`, {
        ...input,
        id: "id-forjado",
        emailVerified: true,
        createdAt: "2000-01-01T00:00:00Z",
      });
      expect(res.status).toBe(200);
      const { rows } = await handle.pool.query<{ id: string; email_verified: boolean; created_at: Date }>(
        `select id, email_verified, created_at from "user" where email = $1`,
        [input.email],
      );
      expect(rows[0]?.id).not.toBe("id-forjado");
      expect(rows[0]?.email_verified).toBe(false);
      expect(rows[0]?.created_at.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    });

    it("e-mail já registado: mesma resposta que um registo novo (sem enumeração)", async () => {
      const first = newUserInput();
      const fresh = await new TestClient(server.baseUrl).post<SignUpBody>(
        `${AUTH}/sign-up/email`,
        first,
      );
      const duplicate = await new TestClient(server.baseUrl).post<SignUpBody>(
        `${AUTH}/sign-up/email`,
        { ...first, name: "  Outro Nome  ", password: "outra-palavra-passe-2" },
      );
      expect(duplicate.status).toBe(fresh.status);
      expect(Object.keys(duplicate.body.user).sort()).toEqual(Object.keys(fresh.body.user).sort());
      expect(duplicate.body.token).toBeNull();
      expect(duplicate.body.user.name).toBe("Outro Nome");
      expect(duplicate.body.user.id).not.toBe(fresh.body.user.id);

      const { rowCount } = await handle.pool.query(`select 1 from "user" where email = $1`, [
        first.email,
      ]);
      expect(rowCount).toBe(1);
      // A palavra-passe original continua a ser a válida.
      const login = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
        email: first.email,
        password: first.password,
      });
      expect(login.status).toBe(200);
    });

    it("validação acontece antes da verificação de existência (mesmo erro para e-mail novo e existente)", async () => {
      const existing = newUserInput();
      await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, existing);
      const forExisting = await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, {
        ...existing,
        name: " ",
      });
      const forNew = await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, {
        ...newUserInput(),
        name: " ",
      });
      expect(forExisting.status).toBe(400);
      expect(forExisting.text).toBe(forNew.text);
    });
  });

  describe("login, sessão e /me", () => {
    it("login válido define cookie HttpOnly/SameSite=Lax e /me devolve só os dados necessários", async () => {
      const { client, input, userId } = await signedInClient(server, {
        timeZone: "America/Sao_Paulo",
      });
      expect(client.cookies.has(SESSION_COOKIE)).toBe(true);

      const me = await client.get<Record<string, unknown>>("/api/v1/me");
      expect(me.status).toBe(200);
      expect(me.headers.get("cache-control")).toBe("no-store");
      expect(me.body).toEqual({
        id: userId,
        name: input.name,
        email: input.email,
        timeZone: "America/Sao_Paulo",
      });
    });

    it("cookie de sessão local: HttpOnly, SameSite=Lax, Path=/, 7 dias, sem Secure (HTTP local)", async () => {
      const client = new TestClient(server.baseUrl);
      const input = newUserInput();
      await client.post(`${AUTH}/sign-up/email`, input);
      const res = await client.post(`${AUTH}/sign-in/email`, {
        email: input.email,
        password: input.password,
      });
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Lax/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).toMatch(/; Max-Age=604800/);
      expect(cookie).not.toMatch(/; Secure/);
    });

    it.each([
      ["palavra-passe errada", (email: string) => ({ email, password: "palavra-errada-123" })],
      ["e-mail inexistente", () => ({ email: "ninguem@example.test", password: "palavra-errada-123" })],
    ])("login com %s: 401 genérico e sem cookie", async (_label, body) => {
      const { input } = await signedInClient(server);
      const client = new TestClient(server.baseUrl);
      const res = await client.post<{ code: string }>(`${AUTH}/sign-in/email`, body(input.email));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(res.headers.getSetCookie()).toEqual([]);
    });

    it("/me sem sessão ou com cookie inválido: 401 em problem+json", async () => {
      for (const cookie of [undefined, `${SESSION_COOKIE}=forjado.assinatura`]) {
        const client = new TestClient(server.baseUrl);
        const res = await client.get<{ code: string }>(
          "/api/v1/me",
          cookie ? { Cookie: cookie } : {},
        );
        expect(res.status).toBe(401);
        expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
        expect(res.body.code).toBe("UNAUTHENTICATED");
      }
    });

    it("sessões de A e B devolvem as identidades corretas", async () => {
      const a = await signedInClient(server, { name: "Utilizadora A" });
      const b = await signedInClient(server, { name: "Utilizador B" });
      const meA = await a.client.get<{ id: string; name: string }>("/api/v1/me");
      const meB = await b.client.get<{ id: string; name: string }>("/api/v1/me");
      expect(meA.body).toMatchObject({ id: a.userId, name: "Utilizadora A" });
      expect(meB.body).toMatchObject({ id: b.userId, name: "Utilizador B" });
      expect(a.userId).not.toBe(b.userId);
    });

    it("logout invalida a sessão no servidor; reutilizar o cookie antigo falha", async () => {
      const { client } = await signedInClient(server);
      const oldCookie = client.cookieHeader();
      const out = await client.post(`${AUTH}/sign-out`);
      expect(out.status).toBe(200);
      expect(client.cookies.has(SESSION_COOKIE)).toBe(false);

      const replay = new TestClient(server.baseUrl);
      const me = await replay.get("/api/v1/me", { Cookie: oldCookie });
      expect(me.status).toBe(401);
      const session = await replay.get(`${AUTH}/get-session`, { Cookie: oldCookie });
      expect(session.body).toBeNull();
    });
  });

  describe("atualização do perfil e campos internos", () => {
    it("aceita um fuso IANA válido e rejeita inválidos", async () => {
      const { client } = await signedInClient(server);
      const ok = await client.post(`${AUTH}/update-user`, { timeZone: "Asia/Tokyo" });
      expect(ok.status).toBe(200);
      const bad = await client.post<{ code: string }>(`${AUTH}/update-user`, { timeZone: "Marte/Base" });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("INVALID_TIME_ZONE");
      const me = await client.get<{ timeZone: string }>("/api/v1/me");
      expect(me.body.timeZone).toBe("Asia/Tokyo");
    });

    it("não permite alterar e-mail, emailVerified nem imagem pelo cliente", async () => {
      const { client, input, userId } = await signedInClient(server);
      const email = await client.post(`${AUTH}/update-user`, { email: "outro@example.test" });
      expect(email.status).toBe(400);
      const verified = await client.post(`${AUTH}/update-user`, { emailVerified: true });
      expect(verified.status).toBe(400);
      const image = await client.post(`${AUTH}/update-user`, { image: "https://evil.example/a.png" });
      expect(image.status).toBe(400);
      const blankName = await client.post(`${AUTH}/update-user`, { name: "  " });
      expect(blankName.status).toBe(400);

      const { rows } = await handle.pool.query<{ email: string; email_verified: boolean; image: null }>(
        `select email, email_verified, image from "user" where id = $1`,
        [userId],
      );
      expect(rows[0]).toEqual({ email: input.email, email_verified: false, image: null });
    });
  });

  describe("origem e CSRF (proteções oficiais do Better Auth)", () => {
    it("origem não autorizada não executa ações protegidas com um cookie válido", async () => {
      const { client, userId } = await signedInClient(server, { timeZone: "Europe/Lisbon" });
      const attacker = new TestClient(server.baseUrl, { origin: UNTRUSTED_ORIGIN });
      const cookie = { Cookie: client.cookieHeader() };

      const update = await attacker.post<{ code: string }>(`${AUTH}/update-user`, { timeZone: "UTC" }, cookie);
      expect(update.status).toBe(403);
      expect(update.body.code).toBe("INVALID_ORIGIN");

      const signOut = await attacker.post(`${AUTH}/sign-out`, {}, cookie);
      expect(signOut.status).toBe(403);

      const changePassword = await attacker.post(
        `${AUTH}/change-password`,
        { currentPassword: "x", newPassword: "nova-palavra-passe-9", revokeOtherSessions: true },
        cookie,
      );
      expect(changePassword.status).toBe(403);

      // Nada mudou e a sessão continua válida para a origem legítima.
      const { rows } = await handle.pool.query<{ time_zone: string }>(
        `select time_zone from "user" where id = $1`,
        [userId],
      );
      expect(rows[0]?.time_zone).toBe("Europe/Lisbon");
      expect((await client.get("/api/v1/me")).status).toBe(200);
    });

    it("pedido com cookie e sem Origin é recusado", async () => {
      const { client } = await signedInClient(server);
      const noOrigin = new TestClient(server.baseUrl, { origin: null });
      const res = await noOrigin.post<{ code: string }>(
        `${AUTH}/update-user`,
        { timeZone: "UTC" },
        { Cookie: client.cookieHeader() },
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("MISSING_OR_NULL_ORIGIN");
    });

    it("login a partir de uma origem não autorizada é recusado", async () => {
      const { input } = await signedInClient(server);
      const attacker = new TestClient(server.baseUrl, { origin: UNTRUSTED_ORIGIN });
      const res = await attacker.post(`${AUTH}/sign-in/email`, {
        email: input.email,
        password: input.password,
      });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    });
  });
});

describe("cookies em configuração de produção", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, {
      isProduction: true,
      appOrigin: "https://runflow.example",
    });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("usa o prefixo __Secure- e os atributos Secure, HttpOnly e SameSite=Lax", async () => {
    const client = new TestClient(server.baseUrl, { origin: "https://runflow.example" });
    const input = newUserInput();
    expect((await client.post(`${AUTH}/sign-up/email`, input)).status).toBe(200);
    const res = await client.post(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: input.password,
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(cookie).toMatch(/^__Secure-runflow\.session_token=/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
  });
});

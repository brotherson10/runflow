import { signJWT } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMAIL_VERIFICATION_EXPIRES_IN_S, RATE_LIMIT } from "../../src/auth/auth.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import type { MailMessage } from "../../src/mail/mailer.ts";
import {
  AUTH,
  newUserInput,
  startAuthServer,
  TEST_APP_ORIGIN,
  TEST_AUTH_SECRET,
  TestClient,
  tokenFromMail,
  waitForMail,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const RESEND_MAX = RATE_LIMIT.customRules["/send-verification-email"].max;

async function emailVerified(handle: DatabaseHandle, email: string): Promise<boolean | undefined> {
  const { rows } = await handle.pool.query<{ email_verified: boolean }>(
    `select email_verified from "user" where email = $1`,
    [email],
  );
  return rows[0]?.email_verified;
}

describe("verificação de e-mail obrigatória (HTTP + PostgreSQL)", () => {
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

  it("registo → e-mail capturado → login recusado → confirmação → login", async () => {
    const client = new TestClient(server.baseUrl);
    const input = newUserInput();
    const signUp = await client.post<{ token: string | null }>(`${AUTH}/sign-up/email`, input);
    expect(signUp.status).toBe(200);
    expect(signUp.body.token).toBeNull();
    expect(signUp.headers.getSetCookie()).toEqual([]);

    const mail = await waitForMail(server.mailbox, input.email, "email-verification");
    expect(mail.subject).toContain("confirme");
    expect(mail.text).toContain("24 horas");
    // O link aponta para a página da web (origem configurada), não para a API.
    const token = tokenFromMail(mail, "/confirmar-email");
    expect(mail.text).not.toContain("/api/auth/verify-email");

    const before = await client.post<{ code: string }>(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: input.password,
    });
    expect(before.status).toBe(403);
    expect(before.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(before.headers.getSetCookie()).toEqual([]);
    // Sem reenvio automático no login (só a pedido explícito, com rate limiting).
    expect(server.mailbox.find(input.email, "email-verification")).toHaveLength(1);

    const verify = await client.get<{ status: boolean }>(`${AUTH}/verify-email?token=${encodeURIComponent(token)}`);
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe(true);
    // Sem login automático depois da confirmação.
    expect(verify.headers.getSetCookie()).toEqual([]);
    expect(await emailVerified(handle, input.email)).toBe(true);

    const after = await client.post(`${AUTH}/sign-in/email`, { email: input.email, password: input.password });
    expect(after.status).toBe(200);
    expect((await client.get("/api/v1/me")).status).toBe(200);

    // Repetir a confirmação é inofensivo.
    expect((await client.get(`${AUTH}/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(200);
  });

  it("conta não verificada com palavra-passe errada: o mesmo 401 de sempre (nada revelado)", async () => {
    const input = newUserInput();
    await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, input);
    const res = await new TestClient(server.baseUrl).post<{ code: string }>(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: "palavra-passe-errada-123",
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("token inválido, adulterado ou de outro segredo: recusado sem alterar a conta", async () => {
    const input = newUserInput();
    await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, input);
    const valid = tokenFromMail(await waitForMail(server.mailbox, input.email, "email-verification"), "/confirmar-email");
    const otherSecret = await signJWT({ email: input.email }, "outro-segredo-qualquer-0123456789abcdef", 3600);
    const [head, payload, signature] = valid.split(".");
    const tampered = `${head ?? ""}.${payload ?? ""}x.${signature ?? ""}`;

    for (const token of ["nao-e-um-jwt", otherSecret, tampered]) {
      const res = await new TestClient(server.baseUrl).get<{ code: string }>(
        `${AUTH}/verify-email?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_TOKEN");
    }
    expect(await emailVerified(handle, input.email)).toBe(false);
  });

  it("token expirado (24 h): TOKEN_EXPIRED e a conta continua por verificar", async () => {
    const input = newUserInput();
    await new TestClient(server.baseUrl).post(`${AUTH}/sign-up/email`, input);
    const token = tokenFromMail(await waitForMail(server.mailbox, input.email, "email-verification"), "/confirmar-email");
    // Token assinado como o do Better Auth, mas com validade já ultrapassada.
    const expired = await signJWT({ email: input.email }, TEST_AUTH_SECRET, -60);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + (EMAIL_VERIFICATION_EXPIRES_IN_S + 60) * 1000 });
    try {
      for (const value of [token, expired]) {
        const res = await new TestClient(server.baseUrl).get<{ code: string }>(
          `${AUTH}/verify-email?token=${encodeURIComponent(value)}`,
        );
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("TOKEN_EXPIRED");
      }
    } finally {
      vi.useRealTimers();
    }
    expect(await emailVerified(handle, input.email)).toBe(false);
  });

  it("reenvio: resposta neutra e igual para conta por verificar, verificada e inexistente", async () => {
    const pending = newUserInput();
    const done = newUserInput();
    const signUpClient = new TestClient(server.baseUrl);
    await signUpClient.post(`${AUTH}/sign-up/email`, pending);
    await signUpClient.post(`${AUTH}/sign-up/email`, done);
    const doneToken = tokenFromMail(await waitForMail(server.mailbox, done.email, "email-verification"), "/confirmar-email");
    await signUpClient.get(`${AUTH}/verify-email?token=${encodeURIComponent(doneToken)}`);
    await waitForMail(server.mailbox, pending.email, "email-verification");

    const responses = [];
    for (const email of [pending.email, done.email, "ninguem.aqui@example.test"]) {
      // Um IP por pedido: o limite de reenvio é testado à parte.
      const res = await new TestClient(server.baseUrl).post(`${AUTH}/send-verification-email`, { email });
      responses.push({ status: res.status, body: res.body });
    }
    expect(responses).toEqual([
      { status: 200, body: { status: true } },
      { status: 200, body: { status: true } },
      { status: 200, body: { status: true } },
    ]);
    // Só a conta por verificar recebe um novo e-mail.
    const resent = await waitForMail(server.mailbox, pending.email, "email-verification", 2);
    expect(tokenFromMail(resent, "/confirmar-email")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(server.mailbox.find(done.email, "email-verification")).toHaveLength(1);
    expect(server.mailbox.find("ninguem.aqui@example.test", "email-verification")).toHaveLength(0);
  });

  it(`reenvio limitado a ${String(RESEND_MAX)} pedidos por IP em 15 min (429 com Retry-After)`, async () => {
    const client = new TestClient(server.baseUrl);
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let attempt = 0; attempt <= RESEND_MAX; attempt++) {
      const res = await client.post(`${AUTH}/send-verification-email`, { email: "limite@example.test" });
      statuses.push(res.status);
      retryAfter = res.headers.get("retry-after");
    }
    expect(statuses).toEqual([...Array<number>(RESEND_MAX).fill(200), 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});

describe("falha do transporte de e-mail (sem segredos nem tokens nos logs)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  const attempts: MailMessage[] = [];

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle);
    // O transporte falha sempre (ex.: Resend indisponível).
    server.mailbox.send = (message) => {
      attempts.push(message);
      return Promise.reject(new Error(`falha simulada com ${message.text}`));
    };
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("registo, reenvio e recuperação respondem como sempre; o log não tem o link", async () => {
    const input = newUserInput();
    const client = new TestClient(server.baseUrl);
    expect((await client.post(`${AUTH}/sign-up/email`, input)).status).toBe(200);
    const resend = await new TestClient(server.baseUrl).post(`${AUTH}/send-verification-email`, { email: input.email });
    const unknown = await new TestClient(server.baseUrl).post(`${AUTH}/send-verification-email`, {
      email: "desconhecido@example.test",
    });
    expect([resend.status, resend.body]).toEqual([unknown.status, unknown.body]);
    const reset = await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, {
      email: input.email,
      redirectTo: `${TEST_APP_ORIGIN}/redefinir-senha`,
    });
    expect(reset.status).toBe(200);

    await vi.waitFor(() => {
      expect(server.logger.lines.filter((m) => m.includes("Falha ao enviar e-mail"))).toHaveLength(3);
    });
    expect(attempts.map((m) => m.kind).sort()).toEqual(["email-verification", "email-verification", "password-reset"]);
    const logs = server.logger.text();
    expect(logs).not.toMatch(/token=|confirmar-email|redefinir-senha|falha simulada/);
  });
});

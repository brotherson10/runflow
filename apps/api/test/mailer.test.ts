import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emailVerificationLink,
  emailVerificationMessage,
  FileMailbox,
  MailDeliveryError,
  maskEmail,
  MemoryMailbox,
  passwordResetLink,
  passwordResetMessage,
  RESEND_ENDPOINT,
  ResendMailer,
} from "../src/mail/mailer.ts";

const TOKEN = "TOKEN-SECRETO-abc123";

describe("captura local de e-mails", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("o link de redefinição usa a origem configurada e o caminho da interface", () => {
    expect(passwordResetLink("http://localhost:5173", TOKEN)).toBe(
      `http://localhost:5173/redefinir-senha?token=${TOKEN}`,
    );
    expect(passwordResetLink("https://runflow.example", "a b&c")).toBe(
      "https://runflow.example/redefinir-senha?token=a+b%26c",
    );
  });

  it("FileMailbox grava a mensagem num ficheiro e o log não contém o token nem o link", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runflow-mail-"));
    dirs.push(dir);
    const lines: string[] = [];
    const mailbox = new FileMailbox(join(dir, "outbox"), { info: (line) => lines.push(line) });
    const link = passwordResetLink("http://localhost:5173", TOKEN);

    await mailbox.send(passwordResetMessage("ana.corredora@example.test", link, 30));

    const files = readdirSync(join(dir, "outbox"));
    expect(files).toHaveLength(1);
    const file = join(dir, "outbox", files[0] ?? "");
    const content = readFileSync(file, "utf8");
    expect(content).toContain(link);
    expect(content).toContain("Para: ana.corredora@example.test");
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("password-reset");
    expect(lines[0]).toContain("a***@example.test");
    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[0]).not.toContain("redefinir-senha");
    expect(lines[0]).not.toContain("ana.corredora");
  });

  it("MemoryMailbox filtra por destinatário e tipo", async () => {
    const mailbox = new MemoryMailbox();
    await mailbox.send(passwordResetMessage("a@example.test", "http://x/?token=1", 30));
    await mailbox.send(passwordResetMessage("b@example.test", "http://x/?token=2", 30));
    expect(mailbox.find("a@example.test", "password-reset")).toHaveLength(1);
    expect(mailbox.find("a@example.test", "password-changed")).toHaveLength(0);
  });

  it.each([
    ["ana@example.test", "a***@example.test"],
    ["x@y.z", "x***@y.z"],
    ["sem-arroba", "***"],
  ])("maskEmail(%j) = %j", (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe("transporte Resend (HTTPS, fetch simulado: nada é enviado)", () => {
  const API_KEY = "re_chave_ficticia_0123456789";
  const FROM = "RunFlow <nao-responder@runflow.example>";
  const link = emailVerificationLink("https://runflow.example", "eyJhbGciOi.eyJlbWFpbCI6.assinatura");
  const message = emailVerificationMessage("ana@example.test", link, 24);

  function capture(response: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response();
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("POST /emails com Bearer, JSON, Idempotency-Key e destinatário em lista", async () => {
    const { calls, fetchFn } = capture(() => Promise.resolve(Response.json({ id: "49a3999c" })));
    const logs: string[] = [];
    await new ResendMailer({ apiKey: API_KEY, from: FROM, fetch: fetchFn, logger: { info: (m) => logs.push(m) } }).send(message);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(RESEND_ENDPOINT);
    expect(RESEND_ENDPOINT).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toMatch(/^runflow-email-verification-[0-9a-f-]{36}$/);
    expect(typeof call?.init.body).toBe("string");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      from: FROM,
      to: ["ana@example.test"],
      subject: message.subject,
      text: message.text,
    });
    // O log não tem o endereço completo nem o link.
    expect(logs).toEqual(["E-mail enviado (email-verification) para a***@example.test."]);
  });

  it("cada envio tem uma Idempotency-Key diferente", async () => {
    const { calls, fetchFn } = capture(() => Promise.resolve(Response.json({ id: "x" })));
    const mailer = new ResendMailer({ apiKey: API_KEY, from: FROM, fetch: fetchFn });
    await mailer.send(message);
    await mailer.send(message);
    const keys = calls.map((c) => new Headers(c.init.headers).get("idempotency-key"));
    expect(new Set(keys).size).toBe(2);
  });

  it.each([
    ["401 (chave inválida)", () => Promise.resolve(Response.json({ message: `invalid key ${API_KEY}` }, { status: 401 })), /Resend respondeu 401/],
    ["429 (limite)", () => Promise.resolve(Response.json({ message: "rate limit" }, { status: 429 })), /Resend respondeu 429/],
    ["500", () => Promise.resolve(new Response(`erro com ${link}`, { status: 500 })), /Resend respondeu 500/],
    ["erro de rede", () => Promise.reject(new TypeError(`fetch failed ${API_KEY}`)), /erro de rede/],
    ["timeout", () => Promise.reject(new DOMException("timeout", "TimeoutError")), /tempo esgotado/],
  ])("%s: MailDeliveryError sem chave, link nem corpo da resposta", async (_label, response, reason) => {
    const { fetchFn } = capture(response);
    const error: unknown = await new ResendMailer({ apiKey: API_KEY, from: FROM, fetch: fetchFn })
      .send(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailDeliveryError);
    const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
    expect(text).toMatch(reason);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("assinatura");
    expect(text).not.toContain("ana@example.test");
  });

  it("um pedido lento é abortado pelo timeout configurado", async () => {
    const fetchFn = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      })) as unknown as typeof fetch;
    const started = Date.now();
    await expect(new ResendMailer({ apiKey: API_KEY, from: FROM, fetch: fetchFn, timeoutMs: 50 }).send(message)).rejects.toThrow(
      /tempo esgotado/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("e-mail de confirmação", () => {
  it("link para a página /confirmar-email da origem configurada, com o token codificado", () => {
    const url = new URL(emailVerificationLink("https://runflow.example", "a.b+c/d"));
    expect(url.origin).toBe("https://runflow.example");
    expect(url.pathname).toBe("/confirmar-email");
    expect(url.searchParams.get("token")).toBe("a.b+c/d");
  });
});

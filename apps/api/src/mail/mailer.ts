import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Envio de e-mail substituível: memória (testes), ficheiros (desenvolvimento e E2E)
 * e Resend por HTTPS (produção). Todas implementam a mesma interface.
 */
export type MailKind = "password-reset" | "password-changed" | "email-verification";

export interface MailMessage {
  readonly kind: MailKind;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Guarda as mensagens em memória (testes). */
export class MemoryMailbox implements Mailer {
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Mensagens de um destinatário e tipo, da mais antiga para a mais recente. */
  find(to: string, kind: MailKind): MailMessage[] {
    return this.messages.filter((message) => message.to === to && message.kind === kind);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

/** Esconde a parte local do endereço nos logs (ex.: "a***@example.test"). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export interface MailLogger {
  info(message: string): void;
}

/**
 * Escreve cada mensagem num ficheiro local (desenvolvimento). O conteúdo — que
 * inclui o link de recuperação — fica só no ficheiro; o log indica apenas o tipo,
 * o destinatário mascarado e o nome do ficheiro.
 */
export class FileMailbox implements Mailer {
  private readonly directory: string;
  private readonly logger: MailLogger;

  constructor(directory: string, logger: MailLogger = console) {
    this.directory = directory;
    this.logger = logger;
  }

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const file = join(this.directory, `${stamp}-${message.kind}-${randomUUID().slice(0, 8)}.txt`);
    const body = `Para: ${message.to}\nAssunto: ${message.subject}\n\n${message.text}\n`;
    await writeFile(file, body, { encoding: "utf8", mode: 0o600 });
    this.logger.info(
      `E-mail local capturado (${message.kind}) para ${maskEmail(message.to)}: ${file}`,
    );
  }
}

/** Link de redefinição construído a partir da origem configurada (nunca do Host do pedido). */
export function passwordResetLink(appOrigin: string, token: string): string {
  const url = new URL("/redefinir-senha", appOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function passwordResetMessage(
  to: string,
  link: string,
  expiresInMinutes: number,
): MailMessage {
  return {
    kind: "password-reset",
    to,
    subject: "RunFlow — redefinir a palavra-passe",
    text:
      "Recebemos um pedido para redefinir a palavra-passe da sua conta RunFlow.\n\n" +
      `Abra este link para escolher uma nova palavra-passe (válido durante ${String(expiresInMinutes)} minutos e utilizável uma única vez):\n${link}\n\n` +
      "Se não fez este pedido, ignore este e-mail: a palavra-passe atual mantém-se.",
  };
}

export function passwordChangedMessage(to: string): MailMessage {
  return {
    kind: "password-changed",
    to,
    subject: "RunFlow — a sua palavra-passe foi alterada",
    text:
      "A palavra-passe da sua conta RunFlow foi alterada e todas as sessões foram terminadas.\n\n" +
      "Se não foi você, peça de imediato uma nova redefinição de palavra-passe.",
  };
}

/** Link de confirmação de e-mail (página da web, que pede confirmação explícita). */
export function emailVerificationLink(appOrigin: string, token: string): string {
  const url = new URL("/confirmar-email", appOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function emailVerificationMessage(to: string, link: string, expiresInHours: number): MailMessage {
  return {
    kind: "email-verification",
    to,
    subject: "RunFlow — confirme o seu e-mail",
    text:
      "Obrigado por criar uma conta no RunFlow.\n\n" +
      `Abra este link para confirmar o seu e-mail (válido durante ${String(expiresInHours)} horas):\n${link}\n\n` +
      "Só depois da confirmação é possível entrar. Se não criou esta conta, ignore este e-mail.",
  };
}

/**
 * Falha de envio. A mensagem nunca inclui a chave da API, o corpo da resposta do
 * fornecedor nem o conteúdo do e-mail (que pode ter um link com token).
 */
export class MailDeliveryError extends Error {
  constructor(reason: string) {
    super(`Envio de e-mail falhou: ${reason}`);
    this.name = "MailDeliveryError";
  }
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const DEFAULT_MAIL_TIMEOUT_MS = 10_000;

export interface ResendMailerOptions {
  readonly apiKey: string;
  /** Remetente, ex.: "RunFlow <nao-responder@runflow.brotherson.dev>". */
  readonly from: string;
  /** Injetável nos testes (nunca há envio real nos testes). */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly logger?: MailLogger;
}

/**
 * Envio pela API HTTPS da Resend (POST /emails). Sem retries automáticos: um
 * timeout depois de a Resend aceitar a mensagem levaria a e-mails duplicados. Cada
 * envio leva uma `Idempotency-Key` própria (útil se um dia houver repetição).
 */
export class ResendMailer implements Mailer {
  private readonly options: ResendMailerOptions;

  constructor(options: ResendMailerOptions) {
    this.options = options;
  }

  async send(message: MailMessage): Promise<void> {
    const fetchFn = this.options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchFn(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `runflow-${message.kind}-${randomUUID()}`,
          "User-Agent": "runflow-api",
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_MAIL_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MailDeliveryError(timedOut ? "tempo esgotado" : "erro de rede");
    }
    // O corpo é descartado: pode ecoar dados do pedido.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new MailDeliveryError(`Resend respondeu ${String(response.status)}`);
    this.options.logger?.info(`E-mail enviado (${message.kind}) para ${maskEmail(message.to)}.`);
  }
}

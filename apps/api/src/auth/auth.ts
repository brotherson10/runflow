/**
 * Configuração do Better Auth (integração oficial, sem wrappers próprios).
 * Usada pelo servidor e pela CLI de geração do schema (schema-config.ts), para
 * que o schema gerado corresponda exatamente à configuração real.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { LIMITS, timeZoneSchema, userNameSchema } from "@runflow/shared";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";
import type { Database } from "../db/client.ts";
import * as authSchema from "../db/schema/auth.ts";

export const AUTH_BASE_PATH = "/api/auth";
/** Cabeçalho interno com o IP do cliente, definido pelo Express (ver client-ip.ts). */
export const CLIENT_IP_HEADER = "x-runflow-client-ip";
export const COOKIE_PREFIX = "runflow";

export const SESSION_EXPIRES_IN_S = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;
/** Tempo máximo da consulta HIBP; depois disso o pedido é recusado (tente novamente). */
export const PASSWORD_CHECK_TIMEOUT_MS = 5000;

/**
 * Projeto demonstrativo sem envio de e-mail (D52): estes endpoints do Better Auth
 * dependem de e-mail (confirmação, recuperação, troca de endereço) e estão
 * desativados. A API responde 410 com uma mensagem clara (auth/http.ts).
 */
export const EMAIL_DEPENDENT_PATHS = [
  "/send-verification-email",
  "/verify-email",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/change-email",
] as const;

/** Caminhos que definem uma palavra-passe nova, e o campo do corpo que a contém. */
export const NEW_PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
};

/** Limites por IP e por rota, guardados na base de dados (tabela rate_limit). */
export const RATE_LIMIT = {
  window: 60,
  max: 100,
  customRules: {
    "/sign-in/email": { window: 60, max: 5 },
    "/sign-up/email": { window: 60, max: 5 },
    "/change-password": { window: 60, max: 5 },
  },
} as const;

export interface AuthLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface AuthDependencies {
  readonly db: Database;
  /** Origem pública da aplicação; também é a única origem confiável. */
  readonly appOrigin: string;
  readonly secret: string;
  readonly isProduction: boolean;
  readonly logger: AuthLogger;
  /**
   * Verificação de palavras-passe comprometidas (HIBP, k-anonymity). Desligada só
   * fora de produção (readServerConfig). Por omissão: ligada.
   */
  readonly passwordBreachCheck?: { readonly enabled: boolean; readonly timeoutMs?: number };
  /**
   * Prolonga a execução até uma tarefa em segundo plano do Better Auth terminar (na
   * Vercel, `waitUntil` de @vercel/functions: a tarefa termina antes de a função
   * suspender). Num processo contínuo não é preciso.
   */
  readonly background?: (task: Promise<unknown>) => void;
}

function badRequest(code: string, message: string): APIError {
  return new APIError("BAD_REQUEST", { code, message });
}

function validated<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  code: string,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(code, message);
  return result.data;
}

/**
 * Nome, fuso e imagem no registo e na atualização do perfil: validados antes da
 * lógica do Better Auth, igual para e-mails novos e existentes (um nome inválido
 * não revela se a conta existe).
 */
function validateProfileFields(path: string, body: unknown): void {
  if (path !== "/sign-up/email" && path !== "/update-user") return;
  if (typeof body !== "object" || body === null) throw badRequest("INVALID_BODY", "Pedido inválido.");
  const fields = body as Record<string, unknown>;
  const isSignUp = path === "/sign-up/email";
  if (isSignUp || "name" in fields) {
    validated(userNameSchema, fields["name"], "INVALID_NAME", "Nome inválido.");
  }
  if (isSignUp || "timeZone" in fields) {
    validated(timeZoneSchema, fields["timeZone"], "INVALID_TIME_ZONE", "Fuso horário inválido.");
  }
  if ("image" in fields && fields["image"] !== null && fields["image"] !== undefined) {
    throw badRequest("FIELD_NOT_ALLOWED", "Campo não permitido: image.");
  }
}
/**
 * Consulta o HIBP com a função oficial do plugin `haveIBeenPwned` do Better Auth
 * (só os 5 primeiros caracteres do SHA-1 saem do servidor). Não se usa o plugin
 * como wrapper do hash porque:
 * - no /reset-password, o Better Auth consome o token ANTES de calcular o hash: uma
 *   falha do HIBP faria perder o link de recuperação;
 * - o pedido do plugin não tem timeout.
 * Aqui a verificação corre antes de qualquer efeito (token, utilizador) e falha
 * fechada: se não for possível verificar, o pedido é recusado temporariamente.
 */
async function rejectCompromisedPassword(password: string, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  let compromised: boolean;
  try {
    compromised = await Promise.race([isPasswordCompromised(password), timeout]);
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "PASSWORD_CHECK_UNAVAILABLE",
      message: "Não foi possível verificar a palavra-passe agora. Tente novamente dentro de alguns minutos.",
    });
  } finally {
    clearTimeout(timer);
  }
  if (compromised) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_COMPROMISED",
      message: "Esta palavra-passe aparece em fugas de dados conhecidas. Escolha outra.",
    });
  }
}

export function createAuth(deps: AuthDependencies) {
  const { logger } = deps;
  const breachCheck = deps.passwordBreachCheck ?? { enabled: true };
  const breachTimeoutMs = breachCheck.timeoutMs ?? PASSWORD_CHECK_TIMEOUT_MS;

  return betterAuth({
    appName: "RunFlow",
    baseURL: deps.appOrigin,
    basePath: AUTH_BASE_PATH,
    secret: deps.secret,
    trustedOrigins: [deps.appOrigin],
    telemetry: { enabled: false },

    database: drizzleAdapter(deps.db, { provider: "pg", schema: authSchema }),

    user: {
      additionalFields: {
        timeZone: {
          type: "string",
          required: true,
          input: true,
          returned: true,
          validator: { input: timeZoneSchema },
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      // Sem login automático no registo: ativa a proteção contra enumeração de e-mails
      // (resposta igual para e-mails novos e existentes); a web entra a seguir.
      autoSignIn: false,
      // Projeto demonstrativo sem e-mail (D52): o endereço NÃO é verificado e fica
      // com emailVerified = false (nunca marcado artificialmente).
      requireEmailVerification: false,
      minPasswordLength: LIMITS.passwordLength.min,
      maxPasswordLength: LIMITS.passwordLength.max,
      // Resposta a um registo com e-mail já existente: igual à de um registo novo
      // (mesma normalização do nome e sem imagem).
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        name: coreFields.name.trim(),
        image: null,
        ...additionalFields,
        id,
      }),
    },

    // Endpoints que dependem de e-mail: desativados também no Better Auth (defesa em
    // profundidade; a API responde antes com 410, ver auth/http.ts).
    disabledPaths: [...EMAIL_DEPENDENT_PATHS],

    session: {
      expiresIn: SESSION_EXPIRES_IN_S,
      updateAge: SESSION_UPDATE_AGE_S,
      // Sem cache em cookie: logout e revogação têm efeito imediato.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: RATE_LIMIT.window,
      max: RATE_LIMIT.max,
      customRules: RATE_LIMIT.customRules,
    },

    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // Tarefas em segundo plano do próprio Better Auth também ficam ligadas ao pedido.
      ...(deps.background ? { backgroundTasks: { handler: deps.background } } : {}),
      // Secure em produção (HTTPS obrigatório por readServerConfig); local em HTTP.
      useSecureCookies: deps.isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // Só confia no cabeçalho definido pelo Express a partir de req.ip.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], disableIpTracking: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },

    // Antes da lógica do Better Auth: perfil validado e palavra-passe nova verificada
    // (igual para e-mails novos e existentes; nada revela se a conta existe).
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        validateProfileFields(ctx.path, ctx.body);
        // Palavra-passe nova: HIBP antes de qualquer efeito. Fora dos limites de
        // tamanho não consulta (o Better Auth recusa a seguir com o erro próprio).
        const field = NEW_PASSWORD_FIELDS[ctx.path];
        if (breachCheck.enabled && field !== undefined) {
          const body: unknown = ctx.body;
          const password = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[field] : undefined;
          if (
            typeof password === "string" &&
            password.length >= LIMITS.passwordLength.min &&
            password.length <= LIMITS.passwordLength.max
          ) {
            await rejectCompromisedPassword(password, breachTimeoutMs);
          }
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: (user) =>
            Promise.resolve({
              data: {
                ...user,
                name: validated(userNameSchema, user.name, "INVALID_NAME", "Nome inválido."),
                image: null,
              },
            }),
        },
        update: {
          before: (data) => {
            const next: Record<string, unknown> = { ...data };
            if (typeof next["name"] === "string") {
              next["name"] = validated(userNameSchema, next["name"], "INVALID_NAME", "Nome inválido.");
            }
            delete next["image"];
            return Promise.resolve({ data: next });
          },
        },
      },
    },

    logger: {
      level: "warn",
      log: (level, message) => {
        // Só a mensagem: os argumentos extra podem conter dados do pedido.
        const text = `[better-auth] ${message}`;
        if (level === "error") logger.error(text);
        else if (level === "warn") logger.warn(text);
        else logger.info(text);
      },
    },
  });
}

export type RunflowAuth = ReturnType<typeof createAuth>;

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../../src/app.ts";
import { createAuth, type AuthLogger, type RunflowAuth } from "../../../src/auth/auth.ts";
import type { TrustProxySetting } from "../../../src/config.ts";
import type { DatabaseHandle } from "../../../src/db/client.ts";
import type { ApiRateLimitConfig } from "../../../src/http/rate-limit.ts";

export const TEST_APP_ORIGIN = "http://localhost:5173";
export const TEST_AUTH_SECRET = "runflow-test-secret-only-for-local-tests-0123456789";
export const UNTRUSTED_ORIGIN = "https://evil.example";

/** Logger que guarda todas as linhas, para verificar que não há tokens nos logs. */
export class CapturingLogger implements AuthLogger {
  readonly lines: string[] = [];

  private record(level: string, message: string, args: unknown[]): void {
    const extra = args.map((arg) =>
      arg instanceof Error ? `${arg.name}: ${arg.message}` : JSON.stringify(arg),
    );
    this.lines.push([level, message, ...extra].join(" "));
  }

  info(message: string, ...args: unknown[]): void {
    this.record("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.record("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.record("error", message, args);
  }

  text(): string {
    return this.lines.join("\n");
  }
}

export interface AuthTestServer {
  readonly baseUrl: string;
  readonly auth: RunflowAuth;
  readonly logger: CapturingLogger;
  close(): Promise<void>;
}

export interface AuthTestServerOptions {
  readonly trustProxy?: TrustProxySetting;
  readonly isProduction?: boolean;
  readonly appOrigin?: string;
  /** Relógio das rotas de domínio (regra de data futura e rate limiting). */
  readonly clock?: () => Date;
  /** Limites das rotas de domínio; por omissão, altos para não interferir nos testes. */
  readonly apiRateLimit?: ApiRateLimitConfig;
  /** HIBP (simulado por fake-network.ts); por omissão ligado, como em produção. */
  readonly passwordBreachCheck?: { readonly enabled: boolean; readonly timeoutMs?: number };
  /** Tarefas em segundo plano (na Vercel: waitUntil). */
  readonly background?: (task: Promise<unknown>) => void;
}

/** Tempo máximo para pedidos em curso terminarem ao fechar (deteção, não mascaramento). */
const IN_FLIGHT_GRACE_MS = 10_000;

export const RELAXED_API_RATE_LIMIT: ApiRateLimitConfig = {
  read: { windowS: 60, max: 100_000 },
  write: { windowS: 60, max: 100_000 },
};

/**
 * API completa (Express + Better Auth) sobre a base de testes, numa porta efémera.
 * Por omissão confia no proxy de loopback, para cada cliente de teste poder
 * simular um IP diferente via X-Forwarded-For (rate limiting por cliente).
 */
export async function startAuthServer(
  handle: DatabaseHandle,
  options: AuthTestServerOptions = {},
): Promise<AuthTestServer> {
  const logger = new CapturingLogger();
  const auth = createAuth({
    db: handle.db,
    appOrigin: options.appOrigin ?? TEST_APP_ORIGIN,
    secret: TEST_AUTH_SECRET,
    isProduction: options.isProduction ?? false,
    logger,
    ...(options.passwordBreachCheck ? { passwordBreachCheck: options.passwordBreachCheck } : {}),
    ...(options.background ? { background: options.background } : {}),
  });
  const appOrigin = options.appOrigin ?? TEST_APP_ORIGIN;
  const app = createApp({
    auth,
    logger,
    trustProxy: options.trustProxy ?? "loopback",
    domain: {
      db: handle.db,
      trustedOrigins: [appOrigin],
      rateLimit: options.apiRateLimit ?? RELAXED_API_RATE_LIMIT,
      ...(options.clock ? { clock: options.clock } : {}),
    },
  });
  // Conta os pedidos em curso: o fecho espera por eles antes de o teste fechar o
  // pool da base, para nunca haver queries contra um pool já encerrado.
  let inFlight = 0;
  let onIdle: (() => void) | undefined;
  const server: Server = createServer((req, res) => {
    inFlight += 1;
    res.once("close", () => {
      inFlight -= 1;
      if (inFlight === 0) onIdle?.();
    });
    app(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const waitForIdle = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (inFlight === 0) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`Servidor de teste fechado com ${String(inFlight)} pedido(s) ainda em curso.`));
      }, IN_FLIGHT_GRACE_MS);
      onIdle = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    auth,
    logger,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server.closeIdleConnections();
      try {
        await waitForIdle();
      } finally {
        server.closeAllConnections();
      }
      await closed;
    },
  };
}

export interface TestResponse<T = unknown> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
  readonly text: string;
}

let ipCounter = 0;

/** Um IP distinto por cliente (10.77.x.y), para isolar os buckets de rate limiting. */
export function nextClientIp(): string {
  ipCounter += 1;
  return `10.77.${String(Math.floor(ipCounter / 250))}.${String((ipCounter % 250) + 1)}`;
}

/** Cliente HTTP com "cookie jar" mínimo, Origin e IP configuráveis. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  readonly baseUrl: string;
  origin: string | null;
  forwardedFor: string | null;

  constructor(
    baseUrl: string,
    options: { origin?: string | null; forwardedFor?: string | null } = {},
  ) {
    this.baseUrl = baseUrl;
    this.origin = options.origin === undefined ? TEST_APP_ORIGIN : options.origin;
    this.forwardedFor = options.forwardedFor === undefined ? nextClientIp() : options.forwardedFor;
  }

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private storeCookies(headers: Headers): void {
    for (const raw of headers.getSetCookie()) {
      const [pair = ""] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = /max-age=0/i.test(raw) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<TestResponse<T>> {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (this.origin !== null) headers["Origin"] = this.origin;
    if (this.forwardedFor !== null) headers["X-Forwarded-For"] = this.forwardedFor;
    if (this.cookies.size > 0) headers["Cookie"] = this.cookieHeader();
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      redirect: "manual",
    });
    this.storeCookies(response.headers);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, headers: response.headers, body: parsed as T, text };
  }

  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", path, body ?? {}, headers);
  }

  patch<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("PATCH", path, body ?? {}, headers);
  }

  delete<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>("DELETE", path, undefined, headers);
  }

  get<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>("GET", path, undefined, headers);
  }
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  timeZone: string;
}

let userCounter = 0;

export function newUserInput(overrides: Partial<SignUpInput> = {}): SignUpInput {
  userCounter += 1;
  return {
    name: `Corredor Teste ${String(userCounter)}`,
    email: `corredor.${String(Date.now())}.${String(userCounter)}@example.test`,
    password: "palavra-passe-segura-1",
    timeZone: "Europe/Lisbon",
    ...overrides,
  };
}

export const AUTH = "/api/auth";

/**
 * Regista e inicia sessão (projeto sem confirmação de e-mail, D52); devolve o
 * cliente com o cookie de sessão.
 */
export async function signedInClient(
  server: Pick<AuthTestServer, "baseUrl">,
  overrides: Partial<SignUpInput> = {},
): Promise<{ client: TestClient; input: SignUpInput; userId: string }> {
  const client = new TestClient(server.baseUrl);
  const input = newUserInput(overrides);
  const signUp = await client.post<{ user: { id: string } }>(`${AUTH}/sign-up/email`, input);
  if (signUp.status !== 200) throw new Error(`Registo falhou: ${String(signUp.status)} ${signUp.text}`);
  const signIn = await client.post(`${AUTH}/sign-in/email`, {
    email: input.email,
    password: input.password,
  });
  if (signIn.status !== 200) throw new Error(`Login falhou: ${String(signIn.status)} ${signIn.text}`);
  return { client, input, userId: signUp.body.user.id };
}

export const SESSION_COOKIE = "runflow.session_token";


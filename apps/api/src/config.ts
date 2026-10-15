import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_RATE_LIMIT, type ApiRateLimitConfig } from "./http/rate-limit.ts";

export interface ApiConfig {
  readonly port: number;
}

export const DEFAULT_PORT = 3100;

/** Lê a configuração do ambiente; falha cedo com uma mensagem clara. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const raw = env["PORT"]?.trim();
  if (raw === undefined || raw === "") {
    return { port: DEFAULT_PORT };
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`PORT inválida: "${raw}". Use um inteiro entre 0 e 65535.`);
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new Error(`PORT inválida: "${raw}". Use um inteiro entre 0 e 65535.`);
  }
  return { port };
}

/**
 * Lê um URL PostgreSQL do ambiente do servidor (nunca exposto à web).
 * As mensagens de erro não incluem o valor, para não revelar credenciais.
 */
export function readDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  name: "DATABASE_URL" | "TEST_DATABASE_URL" = "DATABASE_URL",
): string {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(`${name} não está definida. Veja .env.example.`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} não é um URL válido.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} tem de usar o protocolo postgres:// ou postgresql://.`);
  }
  if (url.pathname.length <= 1) {
    throw new Error(`${name} tem de indicar o nome da base de dados.`);
  }
  return raw;
}

export type NodeEnvironment = "development" | "test" | "production";

/**
 * Valor de `trust proxy` do Express. Decide de onde vem o IP do cliente usado
 * no rate limiting: `false` (padrão) usa o endereço do socket e ignora
 * X-Forwarded-For; um número de saltos ou uma lista de IPs/CIDRs confia apenas
 * nesses proxies. `true` (confiar em todos) é recusado.
 */
export type TrustProxySetting = false | number | string;

export interface ServerConfig {
  readonly port: number;
  readonly nodeEnv: NodeEnvironment;
  readonly isProduction: boolean;
  readonly databaseUrl: string;
  /** Origem pública da aplicação (ex.: http://localhost:5173). Base dos links e origem confiável. */
  readonly appOrigin: string;
  readonly authSecret: string;
  /** `true` quando o segredo foi gerado em memória (só em desenvolvimento). */
  readonly authSecretIsEphemeral: boolean;
  readonly trustProxy: TrustProxySetting;
  /** Verificação de palavras-passe comprometidas (HIBP). "off" só fora de produção. */
  readonly passwordBreachCheck: PasswordBreachCheck;
  /** Pasta absoluta do build da web servida pelo Express, ou null (não serve a web). */
  readonly webDistDir: string | null;
  readonly apiRateLimit: ApiRateLimitConfig;
  /** Segundos entre limpezas de rate limiting dentro da API; 0 = desligada. */
  readonly rateLimitPurgeIntervalS: number;
  /** Segredo da rota do cron; null = rota desligada. */
  readonly cronSecret: string | null;
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim() ?? "";
  if (raw === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) {
    throw new Error(`${name} tem de ser um inteiro entre 1 e ${String(max)}.`);
  }
  return Number(raw);
}

/** Limites das rotas de domínio (/api/v1), por IP do cliente. */
export function readApiRateLimit(env: NodeJS.ProcessEnv): ApiRateLimitConfig {
  const windowS = readPositiveInt(env, "API_RATE_LIMIT_WINDOW_S", DEFAULT_API_RATE_LIMIT.read.windowS, 86_400);
  return {
    read: { windowS, max: readPositiveInt(env, "API_RATE_LIMIT_READ_MAX", DEFAULT_API_RATE_LIMIT.read.max, 100_000) },
    write: { windowS, max: readPositiveInt(env, "API_RATE_LIMIT_WRITE_MAX", DEFAULT_API_RATE_LIMIT.write.max, 100_000) },
  };
}

export const DEFAULT_RATE_LIMIT_PURGE_INTERVAL_S = 3600;

/**
 * Intervalo da limpeza periódica de rate limiting dentro da API, em segundos
 * (60–86400; "0" desliga, ex.: quando corre por cron com `db:purge-rate-limits`).
 */
export function readRateLimitPurgeIntervalS(env: NodeJS.ProcessEnv): number {
  const raw = env["RATE_LIMIT_PURGE_INTERVAL_S"]?.trim() ?? "";
  if (raw === "0") return 0;
  const value = readPositiveInt(env, "RATE_LIMIT_PURGE_INTERVAL_S", DEFAULT_RATE_LIMIT_PURGE_INTERVAL_S, 86_400);
  if (value < 60) throw new Error("RATE_LIMIT_PURGE_INTERVAL_S tem de ser 0 (desligado) ou um inteiro entre 60 e 86400.");
  return value;
}

export type PasswordBreachCheck = "hibp" | "off";

/**
 * Build da web por omissão, calculado a partir deste ficheiro (src/ ou dist/ de
 * apps/api): não depende da pasta de onde o processo é arrancado.
 */
export const DEFAULT_WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));

export function readPasswordBreachCheck(env: NodeJS.ProcessEnv, isProduction: boolean): PasswordBreachCheck {
  const raw = env["PASSWORD_BREACH_CHECK"]?.trim() || "hibp";
  if (raw !== "hibp" && raw !== "off") throw new Error(`PASSWORD_BREACH_CHECK "${raw}" inválido (use hibp ou off).`);
  if (raw === "off" && isProduction) throw new Error("PASSWORD_BREACH_CHECK=off não é permitido em produção.");
  return raw;
}

/**
 * Pasta do build da web. Em produção é obrigatória (por omissão, DEFAULT_WEB_DIST_DIR);
 * fora de produção só é servida se WEB_DIST_DIR for indicada. Tem de ser absoluta:
 * um caminho relativo dependeria da pasta de arranque.
 */
export function readWebDistDir(env: NodeJS.ProcessEnv, isProduction: boolean): string | null {
  const raw = env["WEB_DIST_DIR"]?.trim() ?? "";
  if (raw === "") return isProduction ? DEFAULT_WEB_DIST_DIR : null;
  if (!isAbsolute(raw)) throw new Error("WEB_DIST_DIR tem de ser um caminho absoluto.");
  return resolve(raw);
}

export const DEFAULT_APP_ORIGIN = "http://localhost:5173";
export const MIN_AUTH_SECRET_LENGTH = 32;

function readNodeEnv(env: NodeJS.ProcessEnv): NodeEnvironment {
  const raw = env["NODE_ENV"]?.trim() ?? "";
  if (raw === "" || raw === "development") return "development";
  if (raw === "test" || raw === "production") return raw;
  throw new Error(`NODE_ENV inválido: "${raw}". Use development, test ou production.`);
}

export function readAppOrigin(raw: string | undefined, isProduction: boolean): string {
  const value = raw?.trim() ?? "";
  if (value === "") {
    if (isProduction) throw new Error("APP_URL é obrigatória em produção.");
    return DEFAULT_APP_ORIGIN;
  }
  const url = URL.parse(value);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("APP_URL tem de ser um URL http(s) válido.");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("APP_URL tem de ser só a origem, sem caminho (ex.: https://exemplo.pt).");
  }
  if (isProduction && url.protocol !== "https:") {
    throw new Error("APP_URL tem de usar https em produção (cookies Secure).");
  }
  return url.origin;
}

export function readTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "false") return false;
  if (value === "true") {
    throw new Error(
      "TRUST_PROXY=true confia em qualquer X-Forwarded-For. Indique o número de proxies ou os seus IPs.",
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Configuração completa do servidor. Em produção falha se faltar o que é
 * obrigatório; em desenvolvimento usa valores locais seguros por omissão.
 */
/**
 * Onde a API corre:
 * - "node": processo contínuo (server.ts) que serve também o build da web e faz a
 *   limpeza de rate limiting com um timer;
 * - "vercel": Vercel Function (vercel.ts). A web é servida pela CDN da Vercel e a
 *   limpeza corre por Vercel Cron (rota autenticada com CRON_SECRET).
 */
export type ServerPlatform = "node" | "vercel";

export const MIN_CRON_SECRET_LENGTH = 32;

/** Segredo do cron (Authorization: Bearer). Obrigatório na Vercel em produção. */
export function readCronSecret(env: NodeJS.ProcessEnv, required: boolean): string | null {
  const raw = env["CRON_SECRET"]?.trim() ?? "";
  if (raw === "") {
    if (required) throw new Error("CRON_SECRET é obrigatória na Vercel em produção (rota do cron).");
    return null;
  }
  if (raw.length < MIN_CRON_SECRET_LENGTH) {
    throw new Error(`CRON_SECRET tem de ter pelo menos ${String(MIN_CRON_SECRET_LENGTH)} caracteres.`);
  }
  return raw;
}

export function readServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  generateSecret: () => string = () => randomBytes(32).toString("base64url"),
  platform: ServerPlatform = "node",
): ServerConfig {
  const nodeEnv = readNodeEnv(env);
  const isProduction = nodeEnv === "production";
  const { port } = readConfig(env);
  const databaseUrl = readDatabaseUrl(env);
  const appOrigin = readAppOrigin(env["APP_URL"], isProduction);

  let authSecret = env["BETTER_AUTH_SECRET"]?.trim() ?? "";
  let authSecretIsEphemeral = false;
  if (authSecret === "") {
    if (nodeEnv !== "development") {
      throw new Error(`BETTER_AUTH_SECRET é obrigatória (NODE_ENV=${nodeEnv}).`);
    }
    authSecret = generateSecret();
    authSecretIsEphemeral = true;
  } else if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(`BETTER_AUTH_SECRET tem de ter pelo menos ${MIN_AUTH_SECRET_LENGTH} caracteres.`);
  }

  const trustProxy = readTrustProxy(env["TRUST_PROXY"]);
  const onVercel = platform === "vercel";
  // Atrás do proxy da Vercel, sem TRUST_PROXY todos os clientes teriam o mesmo IP
  // (o do proxy) e partilhariam os limites de rate limiting.
  if (onVercel && isProduction && trustProxy === false) {
    throw new Error("TRUST_PROXY é obrigatório na Vercel em produção (ex.: 1).");
  }

  return {
    port,
    nodeEnv,
    isProduction,
    databaseUrl,
    appOrigin,
    authSecret,
    authSecretIsEphemeral,
    trustProxy,
    passwordBreachCheck: readPasswordBreachCheck(env, isProduction),
    // Na Vercel a web é servida pela CDN e a limpeza corre por cron, não por timer.
    webDistDir: onVercel ? null : readWebDistDir(env, isProduction),
    apiRateLimit: readApiRateLimit(env),
    rateLimitPurgeIntervalS: onVercel ? 0 : readRateLimitPurgeIntervalS(env),
    cronSecret: readCronSecret(env, onVercel && isProduction),
  };
}

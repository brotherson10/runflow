import type { RequestHandler } from "express";
import type { RunflowAuth } from "../auth/auth.ts";
import { requireSession } from "../auth/http.ts";
import type { Database } from "../db/client.ts";
import { jsonBodyParser } from "./json.ts";
import { requireTrustedOrigin } from "./origin.ts";
import { apiRateLimit, type ApiRateLimitConfig } from "./rate-limit.ts";

/** Dependências comuns aos routers de domínio (treinos, objetivos, dashboard). */
export interface DomainRouterOptions {
  readonly db: Database;
  readonly auth: RunflowAuth;
  readonly trustedOrigins: readonly string[];
  readonly rateLimit: ApiRateLimitConfig;
  /** Relógio injetável (regras de datas e rate limiting determinísticos em testes). */
  readonly clock: () => Date;
}

/**
 * Cadeia comum a todas as rotas de domínio, por esta ordem:
 * rate limiting (por IP) → origem nas escritas → sessão → parser JSON.
 */
export function domainGuards(options: DomainRouterOptions, bucket: string): RequestHandler[] {
  return [
    apiRateLimit(options.db, options.rateLimit, options.clock, bucket),
    requireTrustedOrigin(options.trustedOrigins),
    requireSession(options.auth),
    jsonBodyParser(),
  ];
}

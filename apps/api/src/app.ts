import { randomUUID } from "node:crypto";
import { securityHeaders } from "@runflow/shared";
import express, { type Express } from "express";
import type { RunflowAuth } from "./auth/auth.ts";
import { authLocals, mountAuth, requireSession } from "./auth/http.ts";
import type { TrustProxySetting } from "./config.ts";
import type { Database } from "./db/client.ts";
import { jsonBodyParser } from "./http/json.ts";
import { DEFAULT_API_RATE_LIMIT, type ApiRateLimitConfig } from "./http/rate-limit.ts";
import {
  methodNotAllowed,
  notFoundHandler,
  problemErrorHandler,
  type ErrorLogger,
} from "./problem.ts";
import { createDashboardRouter } from "./dashboard/routes.ts";
import { createGoalsRouter } from "./goals/routes.ts";
import type { DomainRouterOptions } from "./http/domain.ts";
import { createWorkoutsRouter } from "./workouts/routes.ts";
import { createWebRouter, type WebBuild } from "./http/web.ts";

export { JSON_BODY_LIMIT } from "./http/json.ts";

export interface DomainOptions {
  readonly db: Database;
  /** Origens confiáveis para escritas de domínio (as mesmas do Better Auth). */
  readonly trustedOrigins: readonly string[];
  readonly rateLimit?: ApiRateLimitConfig;
  /** Relógio injetável; por omissão, a hora do sistema. */
  readonly clock?: () => Date;
}

export interface AppOptions {
  readonly logger?: ErrorLogger;
  /** Instância do Better Auth. Sem ela, as rotas de autenticação e /me não existem. */
  readonly auth?: RunflowAuth;
  /** `trust proxy` do Express (ver config.ts). Por omissão, nenhum proxy é confiável. */
  readonly trustProxy?: TrustProxySetting;
  /** Rotas de domínio (treinos). Exigem também `auth`. */
  readonly domain?: DomainOptions;
  /** Build da web servido na mesma origem (ver http/web.ts). */
  readonly web?: WebBuild;
  /** Origem pública em HTTPS: acrescenta HSTS e upgrade-insecure-requests. */
  readonly https?: boolean;
}

/** Cria a aplicação sem abrir portas; o arranque fica em server.ts. */
export function createApp(options: AppOptions = {}): Express {
  const logger = options.logger ?? console;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ?? false);

  // Cabeçalhos de segurança em todas as respostas (web e API), da fonte única partilhada.
  const headers = Object.entries(securityHeaders({ https: options.https ?? false }));
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals["requestId"] = requestId;
    res.setHeader("X-Request-Id", requestId);
    for (const [name, value] of headers) res.setHeader(name, value);
    // Respostas da API nunca ficam em cache (as rotas podem ser mais específicas).
    const path = req.path.toLowerCase();
    if (path === "/api" || path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Better Auth antes de qualquer parser JSON (requisito da integração oficial).
  if (options.auth) {
    mountAuth(app, options.auth);
  }

  const v1 = express.Router();

  // Rotas de domínio antes do parser geral: rate limiting, origem e sessão correm antes
  // de o corpo ser lido (o router tem o seu próprio parser).
  if (options.auth && options.domain) {
    const domain: DomainRouterOptions = {
      db: options.domain.db,
      auth: options.auth,
      trustedOrigins: options.domain.trustedOrigins,
      rateLimit: options.domain.rateLimit ?? DEFAULT_API_RATE_LIMIT,
      clock: options.domain.clock ?? (() => new Date()),
    };
    v1.use("/workouts", createWorkoutsRouter(domain));
    v1.use("/goals", createGoalsRouter(domain));
    v1.use("/dashboard", createDashboardRouter(domain));
  }

  // O parser fica no router da API (e não global) para não consumir o corpo dos
  // pedidos de autenticação, que o Better Auth lê diretamente.
  v1.use(jsonBodyParser());

  v1.route("/health")
    .get((_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "ok" });
    })
    .all(methodNotAllowed(["GET", "HEAD"]));

  if (options.auth) {
    v1.route("/me")
      .get(requireSession(options.auth), (_req, res) => {
        const { user } = authLocals(res.locals);
        res.setHeader("Cache-Control", "no-store");
        // Só os dados necessários à interface; nada de campos internos.
        res.status(200).json({
          id: user.id,
          name: user.name,
          email: user.email,
          timeZone: user.timeZone,
        });
      })
      .all(methodNotAllowed(["GET", "HEAD"]));
  }

  app.use("/api/v1", v1);
  // Depois da API: o fallback SPA nunca responde a /api (http/web.ts).
  if (options.web) app.use(createWebRouter(options.web));
  app.use(notFoundHandler);
  app.use(problemErrorHandler(logger));

  return app;
}

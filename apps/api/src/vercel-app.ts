/**
 * App da Vercel Function (vercel.ts exporta-o; api/index.js reexporta o build).
 *
 * - A web é servida pela CDN da Vercel (vercel.json); aqui só a API e o cron.
 * - Um app por instância (Fluid compute reutiliza-a entre pedidos).
 * - Pool pequeno com fecho rápido de clientes inativos e `attachDatabasePool`, que
 *   liberta clientes inativos antes de a instância suspender (recomendação oficial).
 * - `waitUntil`: os envios de e-mail terminam antes de a execução acabar.
 * - As migrations NUNCA correm aqui (passo explícito antes do deploy, D51).
 * - Configuração inválida: falha fechada com 503 (o motivo só fica no log).
 */
import { attachDatabasePool, waitUntil } from "@vercel/functions";
import express, { type Express } from "express";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { readServerConfig } from "./config.ts";
import { createDatabase } from "./db/client.ts";
import { FileMailbox, ResendMailer, type Mailer } from "./mail/mailer.ts";
import { sendProblem } from "./problem.ts";

/** Ligações por instância: várias instâncias somam-se no pooler do Neon. */
export const VERCEL_MAX_CONNECTIONS = 3;
export const VERCEL_IDLE_TIMEOUT_MS = 5000;

function unavailableApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    sendProblem(res, 503, "SERVICE_UNAVAILABLE", "Serviço temporariamente indisponível.");
  });
  return app;
}

export function createVercelApp(env: NodeJS.ProcessEnv = process.env): Express {
  let config;
  try {
    config = readServerConfig(env, undefined, "vercel");
  } catch (error) {
    // Só a mensagem de configuração (nunca inclui valores de segredos).
    console.error("Configuração inválida da API:", error instanceof Error ? error.message : error);
    return unavailableApp();
  }

  const database = createDatabase(config.databaseUrl, {
    maxConnections: VERCEL_MAX_CONNECTIONS,
    idleTimeoutMs: VERCEL_IDLE_TIMEOUT_MS,
    applicationName: "runflow-vercel",
  });
  attachDatabasePool(database.pool);

  const mailer: Mailer =
    config.mail.transport === "resend"
      ? new ResendMailer({ apiKey: config.mail.apiKey, from: config.mail.from, logger: console })
      : new FileMailbox(config.mail.outboxDir);

  const auth = createAuth({
    db: database.db,
    appOrigin: config.appOrigin,
    secret: config.authSecret,
    isProduction: config.isProduction,
    mailer,
    logger: console,
    passwordBreachCheck: { enabled: config.passwordBreachCheck === "hibp" },
    background: waitUntil,
  });

  return createApp({
    auth,
    trustProxy: config.trustProxy,
    https: new URL(config.appOrigin).protocol === "https:",
    domain: {
      db: database.db,
      trustedOrigins: [config.appOrigin],
      rateLimit: config.apiRateLimit,
    },
    ...(config.cronSecret === null
      ? {}
      : { cron: { secret: config.cronSecret, db: database.db, apiRateLimit: config.apiRateLimit } }),
  });
}

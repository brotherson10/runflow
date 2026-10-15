import { createServer } from "node:http";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { readServerConfig, type ServerConfig } from "./config.ts";
import { createDatabase } from "./db/client.ts";
import { startRateLimitPurge } from "./db/rate-limit-purge.ts";
import { loadWebBuild, type WebBuild } from "./http/web.ts";

let config: ServerConfig;
try {
  config = readServerConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (config.authSecretIsEphemeral) {
  console.warn(
    "BETTER_AUTH_SECRET não definida: a usar um segredo temporário (só em desenvolvimento). " +
      "As sessões deixam de ser válidas quando a API reinicia.",
  );
}

// O build da web é validado antes de abrir ligações: uma pasta errada falha já.
let web: WebBuild | undefined;
if (config.webDistDir !== null) {
  try {
    web = loadWebBuild(config.webDistDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (config.passwordBreachCheck === "off") {
  console.warn("PASSWORD_BREACH_CHECK=off: palavras-passe comprometidas não são verificadas (só fora de produção).");
}

const database = createDatabase(config.databaseUrl);
const auth = createAuth({
  db: database.db,
  appOrigin: config.appOrigin,
  secret: config.authSecret,
  isProduction: config.isProduction,
  logger: console,
  passwordBreachCheck: { enabled: config.passwordBreachCheck === "hibp" },
});

const server = createServer(
  createApp({
    auth,
    trustProxy: config.trustProxy,
    https: new URL(config.appOrigin).protocol === "https:",
    ...(web ? { web } : {}),
    domain: {
      db: database.db,
      trustedOrigins: [config.appOrigin],
      rateLimit: config.apiRateLimit,
    },
  }),
);

const stopPurge =
  config.rateLimitPurgeIntervalS > 0
    ? startRateLimitPurge({
        db: database.db,
        apiRateLimit: config.apiRateLimit,
        intervalS: config.rateLimitPurgeIntervalS,
        logger: console,
      })
    : () => Promise.resolve();

server.on("error", (error) => {
  console.error("Não foi possível iniciar a API:", error.message);
  process.exitCode = 1;
  void stopPurge().then(() => database.close());
});

server.listen(config.port, () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;
  console.log(`API RunFlow V2 a ouvir em http://localhost:${String(port)}/api/v1/health`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} recebido; a encerrar a API.`);
  server.close(() => {
    void stopPurge()
      .then(() => database.close())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

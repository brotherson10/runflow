// Apaga registos expirados de rate limiting (api_rate_limit e rate_limit do Better
// Auth) na base indicada por DATABASE_URL, em lotes limitados.
// Uso: npm run db:purge-rate-limits [-- --dry-run] [--retention-s=86400]
//      [--batch-size=1000] [--max-batches=50]
// Para correr por cron (ex.: de hora a hora) com RATE_LIMIT_PURGE_INTERVAL_S=0 na API.
import { parseArgs } from "node:util";
import { readApiRateLimit, readDatabaseUrl } from "../src/config.ts";
import { createDatabase } from "../src/db/client.ts";
import { purgeExpiredRateLimits } from "../src/db/rate-limit-purge.ts";

function integerOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`--${name} tem de ser um inteiro.`);
  return Number(value);
}

let database: ReturnType<typeof createDatabase> | undefined;
try {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "retention-s": { type: "string" },
      "batch-size": { type: "string" },
      "max-batches": { type: "string" },
    },
    strict: true,
  });
  const retentionS = integerOption("retention-s", values["retention-s"]);
  const batchSize = integerOption("batch-size", values["batch-size"]);
  const maxBatches = integerOption("max-batches", values["max-batches"]);
  const url = readDatabaseUrl();
  database = createDatabase(url, { maxConnections: 1, applicationName: "runflow-purge-rate-limits" });
  const { rows } = await database.pool.query<{ db: string }>("select current_database() as db");
  const result = await purgeExpiredRateLimits(database.db, {
    now: new Date(),
    apiRateLimit: readApiRateLimit(process.env),
    dryRun: values["dry-run"],
    ...(retentionS === undefined ? {} : { retentionS }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(maxBatches === undefined ? {} : { maxBatches }),
  });
  const verb = values["dry-run"] ? "elegíveis (dry run, nada apagado)" : "apagados";
  console.log(
    `"${rows[0]?.db ?? "?"}": registos anteriores a ${result.cutoff} ${verb} — ` +
      `api_rate_limit: ${String(result.api.rows)}, rate_limit: ${String(result.auth.rows)}.`,
  );
  if (!result.api.complete || !result.auth.complete) {
    console.log("Limite de lotes atingido: podem restar registos para a próxima execução.");
  }
} catch (error) {
  console.error("Falha na limpeza de rate limiting:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database?.close();
}

// Aplica as migrations versionadas à base indicada por DATABASE_URL. Passo explícito
// da publicação, ANTES de arrancar a nova versão; o servidor nunca migra no arranque.
// Desenvolvimento: npm run db:migrate. Produção (build): npm run db:migrate:deploy.
import { readDatabaseUrl } from "../config.ts";
import { createDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";

let url: string;
try {
  url = readDatabaseUrl();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const database = createDatabase(url, { maxConnections: 1, applicationName: "runflow-migrate" });
try {
  const { rows } = await database.pool.query<{ db: string }>("select current_database() as db");
  console.log(`A aplicar migrations em "${rows[0]?.db ?? "?"}"...`);
  await runMigrations(database.db);
  console.log("Migrations aplicadas.");
} catch (error) {
  console.error("Falha ao aplicar migrations:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

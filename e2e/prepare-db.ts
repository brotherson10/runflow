// Prepara a base de dados E2E: cria-a se faltar, limpa-a e aplica as migrations.
// Uso: E2E_DATABASE_URL=... node --conditions=development e2e/prepare-db.ts
//
// Nos E2E, a API usa de propósito esta mesma base (DATABASE_URL = E2E_DATABASE_URL),
// por isso a comparação "base de testes ≠ base de desenvolvimento" não se aplica
// aqui. Mantêm-se as outras proteções: host local, nome terminado em "_test" e
// verificação de `current_database()` antes de limpar.
import { readDatabaseUrl } from "../apps/api/src/config.ts";
import { runMigrations } from "../apps/api/src/db/migrate.ts";
import {
  assertSafeTestDatabaseUrl,
  ensureTestDatabaseExists,
  openTestDatabase,
  resetTestDatabase,
} from "../apps/api/test/db/support/test-database.ts";

const url = readDatabaseUrl({ DATABASE_URL: process.env["E2E_DATABASE_URL"] });
const target = assertSafeTestDatabaseUrl(url);
process.env["TEST_DATABASE_URL"] = url;
delete process.env["DATABASE_URL"];

await ensureTestDatabaseExists(target);
const handle = openTestDatabase();
try {
  await resetTestDatabase(handle);
  await runMigrations(handle.db);
  console.log(`Base E2E "${target.databaseName}" pronta.`);
} finally {
  await handle.close();
}

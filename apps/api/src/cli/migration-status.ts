// Estado das migrations na base de DATABASE_URL, sem alterar nada: aplicadas,
// pendentes e alteradas depois de aplicadas (hash diferente). Sai com código 1 se
// houver pendentes ou alteradas — útil antes de um deploy e depois de um rollback.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDatabaseUrl } from "../config.ts";
import { createDatabase } from "../db/client.ts";
import { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "../db/migrate.ts";

interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

let url: string;
try {
  url = readDatabaseUrl();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const database = createDatabase(url, { maxConnections: 1, applicationName: "runflow-migration-status" });
try {
  const { rows: exists } = await database.pool.query<{ ok: boolean }>(
    "select to_regclass($1) is not null as ok",
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  const applied = exists[0]?.ok
    ? (
        await database.pool.query<{ hash: string; created_at: string }>(
          `select hash, created_at::text as created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at`,
        )
      ).rows
    : [];
  const byWhen = new Map(applied.map((row) => [Number(row.created_at), row.hash]));
  let problems = 0;
  for (const entry of journal.entries) {
    const sql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const appliedHash = byWhen.get(entry.when);
    if (appliedHash === undefined) {
      problems += 1;
      console.log(`PENDENTE   ${entry.tag}`);
    } else if (appliedHash !== hash) {
      problems += 1;
      console.log(`ALTERADA   ${entry.tag} (o ficheiro mudou depois de aplicado)`);
    } else {
      console.log(`aplicada   ${entry.tag}`);
    }
  }
  const unknown = applied.filter((row) => !journal.entries.some((entry) => entry.when === Number(row.created_at)));
  for (const row of unknown) {
    problems += 1;
    console.log(`DESCONHECIDA na base (created_at ${row.created_at}): versão do código mais antiga do que a base?`);
  }
  if (problems > 0) process.exitCode = 1;
} catch (error) {
  console.error("Falha ao ler o estado das migrations:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

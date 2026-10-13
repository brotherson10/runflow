import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

/**
 * Pasta das migrations SQL versionadas (gerada por `drizzle-kit generate`).
 * Funciona a partir de src/db e de dist/db: ambos ficam dois níveis abaixo de apps/api.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Tabela de histórico das migrations aplicadas (padrão do Drizzle, explícito aqui). */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Aplica as migrations ainda não registadas no histórico. Reexecutar não faz nada
 * se tudo já estiver aplicado. É o único caminho para alterar o schema (D14).
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}

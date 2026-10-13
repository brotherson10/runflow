import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  /** Fecha todas as conexões do pool. Idempotente. */
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly maxConnections?: number;
  readonly applicationName?: string;
  readonly onIdleError?: (error: Error) => void;
}

/**
 * Cria o pool `pg` e o cliente Drizzle. Só é usado no servidor; o URL vem de
 * `readDatabaseUrl()` e nunca do código da web.
 */
export function createDatabase(
  connectionString: string,
  options: DatabaseOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? "runflow-api",
  });
  // Erros em clientes inativos (ex.: a base reinicia) não podem derrubar o processo.
  const onIdleError =
    options.onIdleError ??
    ((error: Error) => {
      console.error("Erro numa conexão inativa da base de dados:", error.message);
    });
  pool.on("error", onIdleError);

  const db = drizzle({ client: pool, schema });
  let closing: Promise<void> | undefined;

  return {
    db,
    pool,
    close() {
      closing ??= pool.end();
      return closing;
    },
  };
}

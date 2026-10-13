/**
 * Proteções para testes com PostgreSQL real. Qualquer operação destrutiva
 * (limpar schemas) passa por `assertSafeTestDatabaseUrl` E por
 * `assertConnectedToTestDatabase`, para nunca correr fora da base de testes.
 */
import pg from "pg";
import { readDatabaseUrl } from "../../../src/config.ts";
import { createDatabase, type DatabaseHandle } from "../../../src/db/client.ts";
import { runMigrations } from "../../../src/db/migrate.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const TEST_DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;

export interface TestDatabaseTarget {
  readonly url: string;
  readonly databaseName: string;
}

/**
 * Valida o URL da base de testes: host local, nome terminado em `_test` e
 * diferente da base de desenvolvimento (`DATABASE_URL`). Lança erro caso contrário.
 */
export function assertSafeTestDatabaseUrl(
  raw: string,
  devDatabaseUrl?: string,
): TestDatabaseTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL não é um URL válido.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL tem de usar postgres://.");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Recusado: a base de testes tem de estar num host local (recebido "${url.hostname}").`,
    );
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Recusado: o nome da base de testes tem de terminar em "_test" (recebido "${databaseName}").`,
    );
  }
  const dev = devDatabaseUrl === undefined ? undefined : URL.parse(devDatabaseUrl);
  if (dev && dev.host === url.host && dev.pathname === url.pathname) {
    throw new Error("Recusado: TEST_DATABASE_URL aponta para a mesma base que DATABASE_URL.");
  }
  return { url: raw, databaseName };
}

export function getTestDatabaseTarget(): TestDatabaseTarget {
  const raw = readDatabaseUrl(process.env, "TEST_DATABASE_URL");
  return assertSafeTestDatabaseUrl(raw, process.env["DATABASE_URL"]);
}

/** Verificação em tempo de execução: a sessão está mesmo ligada a uma base `_test`. */
export async function assertConnectedToTestDatabase(
  client: Pick<pg.Pool | pg.Client, "query">,
): Promise<string> {
  const { rows } = await client.query<{ db: string }>("select current_database() as db");
  const name = rows[0]?.db ?? "";
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`Recusado: ligado a "${name}", que não é uma base de testes.`);
  }
  return name;
}

/** Cria a base de testes se ainda não existir (nunca apaga bases). */
export async function ensureTestDatabaseExists(target: TestDatabaseTarget): Promise<void> {
  const adminUrl = new URL(target.url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [
      target.databaseName,
    ]);
    if (rowCount === 0) {
      // O nome já foi validado por TEST_DATABASE_NAME (só [a-z0-9_]), por isso é seguro citá-lo.
      await admin.query(`create database "${target.databaseName}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Espera máxima por locks durante a limpeza: um bloqueio falha de forma explícita. */
export const RESET_LOCK_TIMEOUT = "5s";

/**
 * Esvazia a base de testes (schemas `public` e `drizzle`). Protegido duas vezes:
 * pelo URL e pela base efetivamente ligada.
 *
 * Antes de limpar, falha se outra sessão tiver uma transação aberta na base de
 * testes (sinal de uma ligação que um teste anterior não fechou). O DROP corre
 * com `lock_timeout`, para que um bloqueio inesperado dê erro claro em vez de
 * esperar indefinidamente.
 */
export async function resetTestDatabase(handle: DatabaseHandle): Promise<void> {
  getTestDatabaseTarget();
  const client = await handle.pool.connect();
  try {
    await assertConnectedToTestDatabase(client);
    const { rows: open } = await client.query<{ pid: number; application_name: string; state: string }>(
      `select pid, application_name, state from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and (state like 'idle in transaction%' or wait_event_type = 'Lock')`,
    );
    if (open.length > 0) {
      const sessions = open.map((s) => `${String(s.pid)}/${s.application_name}/${s.state}`).join(", ");
      throw new Error(`Base de testes com transações abertas por outras sessões: ${sessions}`);
    }
    await client.query(`set lock_timeout = '${RESET_LOCK_TIMEOUT}'`);
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query("reset lock_timeout");
  } finally {
    client.release();
  }
}

export function openTestDatabase(): DatabaseHandle {
  const { url } = getTestDatabaseTarget();
  return createDatabase(url, { maxConnections: 8, applicationName: "runflow-db-tests" });
}

/** Base de testes vazia com todas as migrations aplicadas. */
export async function freshMigratedTestDatabase(): Promise<DatabaseHandle> {
  const handle = openTestDatabase();
  await resetTestDatabase(handle);
  await runMigrations(handle.db);
  return handle;
}

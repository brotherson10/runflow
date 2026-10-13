import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../../src/db/migrate.ts";
import { goals, workouts } from "../../src/db/schema/index.ts";
import { insertTestUser } from "./support/fixtures.ts";
import { openTestDatabase, resetTestDatabase } from "./support/test-database.ts";

interface SchemaSnapshot {
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
}

/** Fotografia determinística do schema `public` (colunas, constraints e índices). */
async function snapshotSchema(handle: DatabaseHandle): Promise<SchemaSnapshot> {
  const columns = await handle.pool.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema = 'public'
      order by table_name, column_name`,
  );
  const constraints = await handle.pool.query(
    `select c.conrelid::regclass::text as table_name, c.conname, pg_get_constraintdef(c.oid) as def
       from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' order by 1, 2`,
  );
  const indexes = await handle.pool.query(
    `select tablename, indexname, indexdef from pg_indexes
      where schemaname = 'public' order by tablename, indexname`,
  );
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

async function appliedMigrations(handle: DatabaseHandle): Promise<number> {
  const { rows } = await handle.pool.query<{ n: string }>(
    "select count(*)::text as n from drizzle.__drizzle_migrations",
  );
  return Number(rows[0]?.n);
}

function journalEntries(): number {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

describe("migrations", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openTestDatabase();
    await resetTestDatabase(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("aplicam numa base vazia", async () => {
    const before = await handle.pool.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(before.rows[0]).toEqual({ n: 0 });

    await runMigrations(handle.db);

    const { rows } = await handle.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "account",
      "api_rate_limit",
      "goals",
      "rate_limit",
      "session",
      "user",
      "verification",
      "workouts",
    ]);
    expect(await appliedMigrations(handle)).toBe(journalEntries());
  });

  it("0001 aplica-se sobre uma base com utilizadores existentes (fuso UTC por omissão)", async () => {
    await resetTestDatabase(handle);
    // Pasta temporária só com a primeira migration (journal truncado).
    const partial = mkdtempSync(join(tmpdir(), "runflow-migrations-"));
    try {
      cpSync(MIGRATIONS_FOLDER, partial, { recursive: true });
      const journalPath = join(partial, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
      writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
      await migrate(handle.db, {
        migrationsFolder: partial,
        migrationsSchema: "drizzle",
        migrationsTable: "__drizzle_migrations",
      });
    } finally {
      rmSync(partial, { recursive: true, force: true });
    }
    await handle.pool.query(
      `insert into "user" (id, name, email) values ('antigo', 'Antigo', 'antigo@example.test')`,
    );

    await runMigrations(handle.db);

    const { rows } = await handle.pool.query<{ time_zone: string; column_default: string | null }>(
      `select u.time_zone, c.column_default from "user" u
         cross join information_schema.columns c
        where u.id = 'antigo' and c.table_name = 'user' and c.column_name = 'time_zone'`,
    );
    expect(rows[0]).toEqual({ time_zone: "UTC", column_default: null });
    expect(await appliedMigrations(handle)).toBe(journalEntries());
  });

  it("reexecutar não altera o schema nem perde dados", async () => {
    const userId = await insertTestUser(handle.db);
    await handle.db.insert(goals).values({ userId, title: "10 km", targetDistanceM: 10000 });
    await handle.db
      .insert(workouts)
      .values({ userId, performedOn: "2026-10-12", distanceM: 5000, durationS: 1500 });
    const schemaBefore = await snapshotSchema(handle);
    const migrationsBefore = await appliedMigrations(handle);

    await runMigrations(handle.db);
    await runMigrations(handle.db);

    expect(await snapshotSchema(handle)).toEqual(schemaBefore);
    expect(await appliedMigrations(handle)).toBe(migrationsBefore);
    expect(await handle.db.$count(goals)).toBe(1);
    expect(await handle.db.$count(workouts)).toBe(1);
  });

  it("instantes em TIMESTAMPTZ e datas civis em DATE", async () => {
    const { rows } = await handle.pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and data_type like 'timestamp%' or
              (table_schema = 'public' and column_name in ('performed_on', 'target_date'))
        order by 1, 2`,
    );
    const timestamps = rows.filter((row) => row.data_type.startsWith("timestamp"));
    expect(timestamps.length).toBeGreaterThanOrEqual(16);
    for (const column of timestamps) {
      expect(column.data_type, `${column.table_name}.${column.column_name}`).toBe(
        "timestamp with time zone",
      );
    }
    const civil = rows.filter((row) => ["performed_on", "target_date"].includes(row.column_name));
    expect(civil.map((row) => row.data_type)).toEqual(["date", "date"]);
  });

  it("user.id é text (formato do Better Auth) e as FKs de domínio também", async () => {
    const { rows } = await handle.pool.query<{ table_name: string; data_type: string }>(
      `select table_name, data_type from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'user' and column_name = 'id') or column_name = 'user_id')
        order by table_name`,
    );
    expect(rows).toEqual([
      { table_name: "account", data_type: "text" },
      { table_name: "goals", data_type: "text" },
      { table_name: "session", data_type: "text" },
      { table_name: "user", data_type: "text" },
      { table_name: "workouts", data_type: "text" },
    ]);
  });

  it("cria o índice único parcial e o índice de histórico", async () => {
    const { rows } = await handle.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and indexname in
          ('goals_one_active_per_user_idx', 'workouts_user_history_idx')
        order by indexname`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.indexdef).toMatch(
      /CREATE UNIQUE INDEX goals_one_active_per_user_idx ON public\.goals USING btree \(user_id\) WHERE \(status = 'active'::text\)/,
    );
    expect(rows[1]?.indexdef).toContain(
      "(user_id, performed_on DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST)",
    );
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { goals } from "../../src/db/schema/index.ts";
import { expectPgError, insertTestUser, pgConstraint, pgErrorCode, SQLSTATE } from "./support/fixtures.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const ACTIVE_INDEX = "goals_one_active_per_user_idx";

describe("no máximo um objetivo active por utilizador", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("rejeita um segundo objetivo active do mesmo utilizador", async () => {
    const userId = await insertTestUser(handle.db);
    await handle.db.insert(goals).values({ userId, title: "10 km", targetDistanceM: 10000 });
    await expectPgError(
      handle.db.insert(goals).values({ userId, title: "Meia", targetDistanceM: 21097 }),
      SQLSTATE.uniqueViolation,
      ACTIVE_INDEX,
    );
  });

  it("utilizadores distintos podem ter, cada um, um objetivo active", async () => {
    const ana = await insertTestUser(handle.db, "ana");
    const rui = await insertTestUser(handle.db, "rui");
    await handle.db.insert(goals).values([
      { userId: ana, title: "10 km", targetDistanceM: 10000 },
      { userId: rui, title: "10 km", targetDistanceM: 10000 },
    ]);
    const active = await handle.db.select().from(goals).where(eq(goals.status, "active"));
    expect(active.filter((goal) => goal.userId === ana || goal.userId === rui)).toHaveLength(2);
  });

  it("permite novo active depois de concluir ou substituir o anterior", async () => {
    const userId = await insertTestUser(handle.db);
    const [first] = await handle.db
      .insert(goals)
      .values({ userId, title: "5 km", targetDistanceM: 5000 })
      .returning({ id: goals.id });
    await handle.db
      .update(goals)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(goals.id, first?.id ?? ""));
    const [second] = await handle.db
      .insert(goals)
      .values({ userId, title: "10 km", targetDistanceM: 10000 })
      .returning({ id: goals.id });
    await handle.db
      .update(goals)
      .set({ status: "replaced", replacedAt: new Date() })
      .where(eq(goals.id, second?.id ?? ""));
    await handle.db.insert(goals).values({ userId, title: "Meia", targetDistanceM: 21097 });

    const rows = await handle.db.select().from(goals).where(eq(goals.userId, userId));
    expect(rows.map((goal) => goal.status).sort()).toEqual(["active", "completed", "replaced"]);
  });

  it("transação concorrente: a segunda espera pela primeira e é rejeitada", async () => {
    const userId = await insertTestUser(handle.db);
    const first = await handle.pool.connect();
    const second = await handle.pool.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query(
        "insert into goals (user_id, title, target_distance_m) values ($1, 'A', 1000)",
        [userId],
      );
      // Fica bloqueada no índice único até a primeira transação terminar.
      const pending = second
        .query("insert into goals (user_id, title, target_distance_m) values ($1, 'B', 2000)", [userId])
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      await first.query("commit");
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(pgErrorCode(outcome.error)).toBe(SQLSTATE.uniqueViolation);
        expect(pgConstraint(outcome.error)).toBe(ACTIVE_INDEX);
      }
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }
    const rows = await handle.db.select().from(goals).where(eq(goals.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("A");
  });

  it("várias inserções em paralelo: exatamente uma é aceite", async () => {
    const userId = await insertTestUser(handle.db);
    const attempts = Array.from({ length: 6 }, (_, index) =>
      handle.db.insert(goals).values({ userId, title: `Tentativa ${String(index)}`, targetDistanceM: 5000 }),
    );
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const result of rejected) {
      expect(pgErrorCode(result.reason)).toBe(SQLSTATE.uniqueViolation);
    }
    expect(await handle.db.$count(goals, eq(goals.userId, userId))).toBe(1);
  });
});

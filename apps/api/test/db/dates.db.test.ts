import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { goals, workouts } from "../../src/db/schema/index.ts";
import { insertTestUser } from "./support/fixtures.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

const CIVIL_DATES = ["2026-03-29", "2026-10-25", "2024-02-29", "1970-01-01", "2026-12-31", "9999-12-31"];
const PROCESS_TIME_ZONES = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Europe/Lisbon"];

describe("datas civis e instantes no round-trip", () => {
  let handle: DatabaseHandle;
  let userId: string;
  const originalTz = process.env["TZ"];

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    userId = await insertTestUser(handle.db);
  });

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = originalTz;
    }
  });

  afterAll(async () => {
    await handle.close();
  });

  it.each(PROCESS_TIME_ZONES)("performed_on mantém o dia com o processo em %s", async (timeZone) => {
    process.env["TZ"] = timeZone;
    for (const performedOn of CIVIL_DATES) {
      const [inserted] = await handle.db
        .insert(workouts)
        .values({ userId, performedOn, distanceM: 5000, durationS: 1500 })
        .returning();
      expect(inserted?.performedOn).toBe(performedOn);

      const [read] = await handle.db
        .select({ performedOn: workouts.performedOn, asText: sql<string>`${workouts.performedOn}::text` })
        .from(workouts)
        .where(eq(workouts.id, inserted?.id ?? ""));
      expect(read).toEqual({ performedOn, asText: performedOn });
    }
  });

  it("target_date mantém o dia e aceita null", async () => {
    process.env["TZ"] = "Pacific/Kiritimati";
    const [withDate] = await handle.db
      .insert(goals)
      .values({ userId, title: "Maratona", targetDistanceM: 42195, targetDate: "2027-04-25" })
      .returning();
    expect(withDate?.targetDate).toBe("2027-04-25");
    await handle.db
      .update(goals)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(goals.id, withDate?.id ?? ""));

    const [withoutDate] = await handle.db
      .insert(goals)
      .values({ userId, title: "10 km", targetDistanceM: 10000 })
      .returning();
    expect(withoutDate?.targetDate).toBeNull();
  });

  it("o fuso da sessão PostgreSQL não altera colunas DATE", async () => {
    const client = await handle.pool.connect();
    try {
      for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
        await client.query(`set time zone '${zone}'`);
        const { rows } = await client.query<{ day: string }>(
          "select performed_on::text as day from workouts where performed_on = date '2026-03-29' limit 1",
        );
        expect(rows[0]?.day).toBe("2026-03-29");
      }
    } finally {
      await client.query("reset time zone");
      client.release();
    }
  });

  it("TIMESTAMPTZ preserva o instante, independentemente do fuso do processo", async () => {
    const instant = new Date("2026-10-12T23:30:00.123Z");
    process.env["TZ"] = "America/Los_Angeles";
    const [row] = await handle.db
      .insert(goals)
      .values({ userId, title: "Instante", targetDistanceM: 5000, status: "completed", completedAt: instant })
      .returning();
    process.env["TZ"] = "Pacific/Kiritimati";
    const [read] = await handle.db
      .select({ completedAt: goals.completedAt })
      .from(goals)
      .where(eq(goals.id, row?.id ?? ""));
    expect(read?.completedAt?.toISOString()).toBe(instant.toISOString());
  });
});

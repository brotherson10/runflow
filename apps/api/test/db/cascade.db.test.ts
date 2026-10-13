import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { account, goals, session, user, workouts } from "../../src/db/schema/index.ts";
import { insertTestUser } from "./support/fixtures.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

async function seedUserData(handle: DatabaseHandle, userId: string): Promise<void> {
  const now = new Date();
  await handle.db.insert(session).values({
    id: `s_${userId}`,
    userId,
    token: `token_${userId}`,
    expiresAt: new Date(now.getTime() + 86_400_000),
    updatedAt: now,
  });
  await handle.db.insert(account).values({
    id: `a_${userId}`,
    userId,
    accountId: userId,
    providerId: "credential",
    updatedAt: now,
  });
  await handle.db.insert(goals).values({ userId, title: "10 km", targetDistanceM: 10000 });
  await handle.db.insert(workouts).values([
    { userId, performedOn: "2026-10-10", distanceM: 5000, durationS: 1500 },
    { userId, performedOn: "2026-10-11", distanceM: 8000, durationS: 2700 },
  ]);
}

async function countsFor(handle: DatabaseHandle, userId: string) {
  return {
    user: await handle.db.$count(user, eq(user.id, userId)),
    session: await handle.db.$count(session, eq(session.userId, userId)),
    account: await handle.db.$count(account, eq(account.userId, userId)),
    goals: await handle.db.$count(goals, eq(goals.userId, userId)),
    workouts: await handle.db.$count(workouts, eq(workouts.userId, userId)),
  };
}

describe("eliminação de conta (política: cascade total)", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("apagar o utilizador remove sessões, contas, objetivos e treinos dele", async () => {
    const leaving = await insertTestUser(handle.db, "sai");
    const staying = await insertTestUser(handle.db, "fica");
    await seedUserData(handle, leaving);
    await seedUserData(handle, staying);
    expect(await countsFor(handle, leaving)).toEqual({
      user: 1,
      session: 1,
      account: 1,
      goals: 1,
      workouts: 2,
    });

    await handle.db.delete(user).where(eq(user.id, leaving));

    expect(await countsFor(handle, leaving)).toEqual({
      user: 0,
      session: 0,
      account: 0,
      goals: 0,
      workouts: 0,
    });
    // Os dados de outro utilizador ficam intactos.
    expect(await countsFor(handle, staying)).toEqual({
      user: 1,
      session: 1,
      account: 1,
      goals: 1,
      workouts: 2,
    });
  });

  it("apagar um objetivo não afeta os treinos", async () => {
    const userId = await insertTestUser(handle.db);
    await seedUserData(handle, userId);
    await handle.db.delete(goals).where(eq(goals.userId, userId));
    expect(await handle.db.$count(workouts, eq(workouts.userId, userId))).toBe(2);
  });
});

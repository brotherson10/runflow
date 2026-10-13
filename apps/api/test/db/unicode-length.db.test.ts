import { codePointLength, goalTitleSchema, LIMITS, notesSchema } from "@runflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNICODE_SAMPLES } from "../../../../packages/shared/test/fixtures/unicode-samples.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { goals, workouts } from "../../src/db/schema/index.ts";
import { expectPgError, insertTestUser, SQLSTATE } from "./support/fixtures.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

// Alinhamento entre a contagem dos schemas partilhados (code points) e o
// char_length do PostgreSQL (base UTF-8), com acentos combinados e emojis.

describe("contagem de caracteres: schemas partilhados vs char_length", () => {
  let handle: DatabaseHandle;
  let userId: string;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    userId = await insertTestUser(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("a base usa codificação UTF-8", async () => {
    const { rows } = await handle.pool.query<{ encoding: string }>(
      "select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()",
    );
    expect(rows[0]?.encoding).toBe("UTF8");
  });

  it.each(UNICODE_SAMPLES)("$label: char_length = codePointLength = $codePoints", async ({ value, codePoints }) => {
    const { rows } = await handle.pool.query<{ n: number }>("select char_length($1::text) as n", [value]);
    expect(rows[0]?.n).toBe(codePoints);
    expect(codePointLength(value)).toBe(codePoints);
  });

  it("título com 80 code points em emojis compostos: aceite nos dois lados; 81 rejeitado nos dois", async () => {
    const families = "👨‍👩‍👧".repeat(16);
    expect(goalTitleSchema.safeParse(families).success).toBe(true);
    await handle.db.insert(goals).values({ userId, title: families, targetDistanceM: 5000 });

    const tooLong = `${families}x`;
    expect(goalTitleSchema.safeParse(tooLong).success).toBe(false);
    await expectPgError(
      handle.db.insert(goals).values({
        userId,
        title: tooLong,
        targetDistanceM: 5000,
        status: "completed",
        completedAt: new Date(),
      }),
      SQLSTATE.checkViolation,
      "goals_title_length_chk",
    );
  });

  it("notas com acentos decompostos no limite: aceites nos dois lados; +1 rejeitado nos dois", async () => {
    const decomposed = "é".repeat(LIMITS.notesMaxLength / 2);
    expect(notesSchema.safeParse(decomposed).success).toBe(true);
    const [row] = await handle.db
      .insert(workouts)
      .values({ userId, performedOn: "2026-10-12", distanceM: 5000, durationS: 1500, notes: decomposed })
      .returning({ notes: workouts.notes });
    // O texto não é normalizado: a forma decomposta é guardada tal como chegou.
    expect(row?.notes).toBe(decomposed);

    const tooLong = `${decomposed}e`;
    expect(notesSchema.safeParse(tooLong).success).toBe(false);
    await expectPgError(
      handle.db
        .insert(workouts)
        .values({ userId, performedOn: "2026-10-12", distanceM: 5000, durationS: 1500, notes: tooLong }),
      SQLSTATE.checkViolation,
      "workouts_notes_chk",
    );
  });
});

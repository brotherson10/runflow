import { LIMITS } from "@runflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { goals, workouts } from "../../src/db/schema/index.ts";
import { expectPgError, insertTestUser, SQLSTATE } from "./support/fixtures.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

// Integridade dos dados. Estas constraints NÃO provam autorização: o isolamento
// entre utilizadores será testado nas queries/API na fase de autenticação.

describe("constraints de workouts (alinhadas com LIMITS)", () => {
  let handle: DatabaseHandle;
  let userId: string;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    userId = await insertTestUser(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  const base = () => ({
    userId,
    performedOn: "2026-10-12",
    distanceM: 5000,
    durationS: 1500,
  });

  it("aceita os limites inclusivos", async () => {
    await handle.db.insert(workouts).values([
      { ...base(), distanceM: LIMITS.distanceM.min, durationS: LIMITS.durationS.min },
      { ...base(), distanceM: LIMITS.distanceM.max, durationS: LIMITS.durationS.max },
      { ...base(), performedOn: LIMITS.minWorkoutDate, notes: "x".repeat(LIMITS.notesMaxLength) },
    ]);
  });

  it.each([
    ["distância 0", { distanceM: LIMITS.distanceM.min - 1 }, "workouts_distance_chk"],
    ["distância acima do máximo", { distanceM: LIMITS.distanceM.max + 1 }, "workouts_distance_chk"],
    ["distância negativa", { distanceM: -5 }, "workouts_distance_chk"],
    ["duração 0", { durationS: LIMITS.durationS.min - 1 }, "workouts_duration_chk"],
    ["duração acima do máximo", { durationS: LIMITS.durationS.max + 1 }, "workouts_duration_chk"],
    ["data antes de 1970", { performedOn: "1969-12-31" }, "workouts_performed_on_range_chk"],
    ["notas vazias", { notes: "" }, "workouts_notes_chk"],
    ["notas só com espaços", { notes: " \t\n " }, "workouts_notes_chk"],
    ["notas com 1001 caracteres", { notes: "x".repeat(LIMITS.notesMaxLength + 1) }, "workouts_notes_chk"],
  ])("rejeita %s", async (_label, override, constraint) => {
    await expectPgError(
      handle.db.insert(workouts).values({ ...base(), ...override }),
      SQLSTATE.checkViolation,
      constraint,
    );
  });

  it("conta caracteres como o schema partilhado (code points)", async () => {
    const emoji = "🏃".repeat(LIMITS.notesMaxLength);
    await handle.db.insert(workouts).values({ ...base(), notes: emoji });
    await expectPgError(
      handle.db.insert(workouts).values({ ...base(), notes: `${emoji}x` }),
      SQLSTATE.checkViolation,
      "workouts_notes_chk",
    );
  });

  it("rejeita valores não inteiros e datas inexistentes ao nível do tipo", async () => {
    await expectPgError(
      handle.pool.query(
        "insert into workouts (user_id, performed_on, distance_m, duration_s) values ($1, $2, $3, $4)",
        [userId, "2026-10-12", "5000.5", 1500],
      ),
      SQLSTATE.invalidTextRepresentation,
    );
    await expectPgError(
      handle.pool.query(
        "insert into workouts (user_id, performed_on, distance_m, duration_s) values ($1, $2, $3, $4)",
        [userId, "2026-02-30", 5000, 1500],
      ),
      "22008", // datetime_field_overflow
    );
  });

  it("rejeita campos obrigatórios em falta", async () => {
    await expectPgError(
      handle.pool.query(
        "insert into workouts (user_id, performed_on, distance_m) values ($1, $2, $3)",
        [userId, "2026-10-12", 5000],
      ),
      SQLSTATE.notNullViolation,
    );
  });

  it("rejeita utilizador inexistente (foreign key)", async () => {
    await expectPgError(
      handle.db.insert(workouts).values({ ...base(), userId: "nao_existe" }),
      SQLSTATE.foreignKeyViolation,
      "workouts_user_id_user_id_fk",
    );
  });
});

describe("constraints de goals (alinhadas com LIMITS)", () => {
  let handle: DatabaseHandle;
  let userId: string;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    userId = await insertTestUser(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("aceita limites de título e distância e o estado active por omissão", async () => {
    const [row] = await handle.db
      .insert(goals)
      .values({
        userId,
        title: "🏃".repeat(LIMITS.goalTitleLength.max),
        targetDistanceM: LIMITS.distanceM.max,
        targetDate: "2027-04-25",
      })
      .returning();
    expect(row?.status).toBe("active");
    expect(row?.completedAt).toBeNull();
  });

  it.each([
    ["título vazio", { title: "" }, "goals_title_length_chk"],
    ["título só com espaços", { title: "   " }, "goals_title_not_blank_chk"],
    ["título com 81 caracteres", { title: "a".repeat(LIMITS.goalTitleLength.max + 1) }, "goals_title_length_chk"],
    ["distância 0", { targetDistanceM: 0 }, "goals_target_distance_chk"],
    ["distância acima do máximo", { targetDistanceM: LIMITS.distanceM.max + 1 }, "goals_target_distance_chk"],
    ["data-alvo acima de 9999", { targetDate: "10000-01-01" }, "goals_target_date_range_chk"],
  ])("rejeita %s", async (_label, override, constraint) => {
    await expectPgError(
      handle.db
        .insert(goals)
        .values({ userId, title: "Meia", targetDistanceM: 21097, status: "completed", completedAt: new Date(), ...override }),
      SQLSTATE.checkViolation,
      constraint,
    );
  });

  it("rejeita estado desconhecido", async () => {
    await expectPgError(
      handle.pool.query(
        "insert into goals (user_id, title, target_distance_m, status) values ($1, 'X', 1000, 'paused')",
        [userId],
      ),
      SQLSTATE.checkViolation,
      "goals_status_chk",
    );
  });

  it("exige coerência entre estado e datas de conclusão/substituição", async () => {
    const values = { userId, title: "Meia", targetDistanceM: 21097 };
    await expectPgError(
      handle.db.insert(goals).values({ ...values, status: "completed" }),
      SQLSTATE.checkViolation,
      "goals_completed_at_chk",
    );
    await expectPgError(
      handle.db.insert(goals).values({ ...values, status: "replaced" }),
      SQLSTATE.checkViolation,
      "goals_replaced_at_chk",
    );
    await expectPgError(
      handle.db
        .insert(goals)
        .values({ ...values, status: "completed", completedAt: new Date(), replacedAt: new Date() }),
      SQLSTATE.checkViolation,
      "goals_replaced_at_chk",
    );
  });

  it("rejeita utilizador inexistente (foreign key)", async () => {
    await expectPgError(
      handle.db.insert(goals).values({ userId: "nao_existe", title: "X", targetDistanceM: 1000 }),
      SQLSTATE.foreignKeyViolation,
      "goals_user_id_user_id_fk",
    );
  });
});

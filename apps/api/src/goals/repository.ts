/**
 * Acesso a dados de objetivos. Todas as funções recebem o `userId` da sessão e
 * filtram por `id` E `user_id`. As transições de estado (editar, concluir,
 * substituir) leem o objetivo com bloqueio (`FOR UPDATE`) dentro de uma transação.
 */
import { goalInputSchema, type GoalPatch } from "@runflow/shared";
import { and, eq, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { goals } from "../db/schema/index.ts";
import { parseOrThrow } from "../http/validation.ts";
import { ProblemError } from "../problem.ts";

export const ONE_ACTIVE_GOAL_INDEX = "goals_one_active_per_user_idx";

export interface GoalDto {
  readonly id: string;
  readonly title: string;
  readonly targetDistanceM: number;
  readonly targetDate: string | null;
  readonly status: "active" | "completed" | "replaced";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly replacedAt: string | null;
}

export interface NewGoal {
  readonly title: string;
  readonly targetDistanceM: number;
  readonly targetDate: string | null;
}

const columns = {
  id: goals.id,
  title: goals.title,
  targetDistanceM: goals.targetDistanceM,
  targetDate: goals.targetDate,
  status: goals.status,
  createdAt: goals.createdAt,
  updatedAt: goals.updatedAt,
  completedAt: goals.completedAt,
  replacedAt: goals.replacedAt,
};

type Row = {
  id: string;
  title: string;
  targetDistanceM: number;
  targetDate: string | null;
  status: "active" | "completed" | "replaced";
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  replacedAt: Date | null;
};

export function toGoalDto(row: Row): GoalDto {
  return {
    id: row.id,
    title: row.title,
    targetDistanceM: row.targetDistanceM,
    targetDate: row.targetDate,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    replacedAt: row.replacedAt?.toISOString() ?? null,
  };
}

const owned = (userId: string, id: string): SQL | undefined =>
  and(eq(goals.id, id), eq(goals.userId, userId));

export function activeGoalExists(): ProblemError {
  return new ProblemError(409, "ACTIVE_GOAL_EXISTS", "Já existe um objetivo ativo.");
}

function goalNotActive(): ProblemError {
  return new ProblemError(409, "GOAL_NOT_ACTIVE", "Só um objetivo ativo pode ser alterado.");
}

type Executor = Pick<Database, "insert" | "select" | "update">;

async function insertActive(executor: Executor, userId: string, input: NewGoal): Promise<GoalDto> {
  try {
    const [row] = await executor
      .insert(goals)
      .values({ ...input, userId, status: "active" })
      .returning(columns);
    if (!row) throw new Error("INSERT sem resultado.");
    return toGoalDto(row);
  } catch (error) {
    // O índice único parcial garante um único ativo, também sob concorrência.
    if (isUniqueViolation(error, ONE_ACTIVE_GOAL_INDEX)) throw activeGoalExists();
    throw error;
  }
}

export function createGoal(db: Database, userId: string, input: NewGoal): Promise<GoalDto> {
  return insertActive(db, userId, input);
}

export async function findActiveGoal(db: Database, userId: string): Promise<GoalDto | null> {
  const [row] = await db
    .select(columns)
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
    .limit(1);
  return row ? toGoalDto(row) : null;
}

/** Lê o objetivo do utilizador com bloqueio; `null` se não existir (ou for de outra pessoa). */
async function lockOwned(executor: Executor, userId: string, id: string): Promise<Row | null> {
  const [row] = await executor.select(columns).from(goals).where(owned(userId, id)).for("update");
  return row ?? null;
}

export async function updateGoal(
  db: Database,
  userId: string,
  id: string,
  patch: GoalPatch,
  checkFinal: (final: NewGoal) => void,
): Promise<GoalDto | null> {
  return db.transaction(async (tx) => {
    // Dono primeiro: para outro utilizador, qualquer pedido é 404 (sem revelar estado).
    const current = await lockOwned(tx, userId, id);
    if (!current) return null;
    if (current.status !== "active") throw goalNotActive();
    const final = parseOrThrow(goalInputSchema, {
      title: patch.title ?? current.title,
      targetDistanceM: patch.targetDistanceM ?? current.targetDistanceM,
      targetDate: patch.targetDate === undefined ? current.targetDate : patch.targetDate,
    });
    checkFinal(final);
    const [row] = await tx
      .update(goals)
      .set({ ...final, updatedAt: new Date() })
      .where(owned(userId, id))
      .returning(columns);
    return row ? toGoalDto(row) : null;
  });
}

export async function completeGoal(db: Database, userId: string, id: string, now: Date): Promise<GoalDto | null> {
  return db.transaction(async (tx) => {
    const current = await lockOwned(tx, userId, id);
    if (!current) return null;
    if (current.status !== "active") throw goalNotActive();
    const [row] = await tx
      .update(goals)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(owned(userId, id))
      .returning(columns);
    return row ? toGoalDto(row) : null;
  });
}

/**
 * Substituição numa única transação: o atual passa a `replaced` e o novo é criado
 * `active`. Qualquer falha (incluindo na criação do novo) desfaz as duas escritas.
 */
export async function replaceGoal(
  db: Database,
  userId: string,
  id: string,
  next: NewGoal,
  now: Date,
  checkNext: () => void,
): Promise<{ previous: GoalDto; current: GoalDto } | null> {
  return db.transaction(async (tx) => {
    const existing = await lockOwned(tx, userId, id);
    if (!existing) return null;
    if (existing.status !== "active") throw goalNotActive();
    checkNext();
    const [previous] = await tx
      .update(goals)
      .set({ status: "replaced", replacedAt: now, updatedAt: now })
      .where(owned(userId, id))
      .returning(columns);
    if (!previous) return null;
    const current = await insertActive(tx, userId, next);
    return { previous: toGoalDto(previous), current };
  });
}

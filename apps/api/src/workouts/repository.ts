/**
 * Acesso a dados de treinos. TODAS as funções recebem o `userId` da sessão e
 * filtram por `id` E `user_id`: não existe forma de ler ou alterar um treino
 * sem indicar o dono.
 */
import { workoutInputSchema, type WorkoutPatch } from "@runflow/shared";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { workouts } from "../db/schema/index.ts";
import { parseOrThrow } from "../http/validation.ts";
import type { CursorPosition } from "./cursor.ts";

export interface WorkoutDto {
  readonly id: string;
  readonly performedOn: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewWorkout {
  readonly performedOn: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly notes: string | null;
}

const columns = {
  id: workouts.id,
  performedOn: workouts.performedOn,
  distanceM: workouts.distanceM,
  durationS: workouts.durationS,
  notes: workouts.notes,
  createdAt: workouts.createdAt,
  updatedAt: workouts.updatedAt,
  // Texto UTC com microssegundos, usado só no cursor (o Date do JS perde precisão).
  cursorCreatedAt: sql<string>`to_char(${workouts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

type Row = {
  id: string;
  performedOn: string;
  distanceM: number;
  durationS: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toDto(row: Row): WorkoutDto {
  return {
    id: row.id,
    performedOn: row.performedOn,
    distanceM: row.distanceM,
    durationS: row.durationS,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const owned = (userId: string, id: string): SQL | undefined =>
  and(eq(workouts.id, id), eq(workouts.userId, userId));

export async function createWorkout(db: Database, userId: string, input: NewWorkout): Promise<WorkoutDto> {
  const [row] = await db
    .insert(workouts)
    .values({ ...input, userId })
    .returning(columns);
  if (!row) throw new Error("INSERT sem resultado.");
  return toDto(row);
}

export async function findWorkout(db: Database, userId: string, id: string): Promise<WorkoutDto | null> {
  const [row] = await db.select(columns).from(workouts).where(owned(userId, id)).limit(1);
  return row ? toDto(row) : null;
}

/**
 * Aplica um PATCH numa transação: lê o treino do utilizador com bloqueio,
 * valida o resultado final e grava. `checkFinal` corre antes da escrita
 * (ex.: regra de data futura).
 */
export async function updateWorkout(
  db: Database,
  userId: string,
  id: string,
  patch: WorkoutPatch,
  checkFinal: (final: NewWorkout) => void,
): Promise<WorkoutDto | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select(columns).from(workouts).where(owned(userId, id)).for("update");
    if (!current) return null;
    const final = parseOrThrow(workoutInputSchema, {
      performedOn: patch.performedOn ?? current.performedOn,
      distanceM: patch.distanceM ?? current.distanceM,
      durationS: patch.durationS ?? current.durationS,
      notes: patch.notes === undefined ? current.notes : patch.notes,
    });
    checkFinal(final);
    const [row] = await tx
      .update(workouts)
      .set({ ...final, updatedAt: new Date() })
      .where(owned(userId, id))
      .returning(columns);
    return row ? toDto(row) : null;
  });
}

export async function deleteWorkout(db: Database, userId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(workouts).where(owned(userId, id)).returning({ id: workouts.id });
  return deleted.length > 0;
}

export interface ListOptions {
  readonly from: string | null;
  readonly to: string | null;
  readonly limit: number;
  readonly after: CursorPosition | null;
}

export interface ListPage {
  readonly items: WorkoutDto[];
  /** Posição do último item, quando existe uma página seguinte. */
  readonly next: CursorPosition | null;
}

/** Histórico do utilizador: performed_on DESC, created_at DESC, id DESC (keyset). */
export async function listWorkouts(db: Database, userId: string, options: ListOptions): Promise<ListPage> {
  const conditions: (SQL | undefined)[] = [eq(workouts.userId, userId)];
  if (options.from !== null) conditions.push(gte(workouts.performedOn, options.from));
  if (options.to !== null) conditions.push(lte(workouts.performedOn, options.to));
  if (options.after !== null) {
    const { performedOn, createdAt, id } = options.after;
    conditions.push(
      sql`(${workouts.performedOn}, ${workouts.createdAt}, ${workouts.id}) < (${performedOn}::date, ${createdAt}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select(columns)
    .from(workouts)
    .where(and(...conditions))
    .orderBy(desc(workouts.performedOn), desc(workouts.createdAt), desc(workouts.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  const hasMore = rows.length > options.limit;
  return {
    items: page.map(toDto),
    next:
      hasMore && last
        ? { performedOn: last.performedOn, createdAt: last.cursorCreatedAt, id: last.id }
        : null,
  };
}

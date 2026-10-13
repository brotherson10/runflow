/**
 * Tabelas de domínio do RunFlow V2. Todas pertencem a um utilizador (`user_id`).
 *
 * Os limites repetem `LIMITS` de @runflow/shared (a validação principal é feita
 * pelos schemas Zod no servidor); os testes de base de dados verificam que os
 * dois continuam alinhados. As constraints são uma rede de segurança de
 * integridade, NÃO uma prova de autorização: o isolamento entre utilizadores
 * tem de ser garantido nas queries e testado na fase de autenticação.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

export const GOAL_STATUSES = ["active", "completed", "replaced"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDistanceM: integer("target_distance_m").notNull(),
    targetDate: date("target_date", { mode: "string" }),
    status: text("status", { enum: GOAL_STATUSES }).notNull().default("active"),
    ...timestamps,
    completedAt: timestamp("completed_at", { withTimezone: true }),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
  },
  (table) => [
    // No máximo um objetivo ativo por utilizador (também sob concorrência).
    uniqueIndex("goals_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("goals_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("goals_title_length_chk", sql`char_length(${table.title}) between 1 and 80`),
    check("goals_title_not_blank_chk", sql`${table.title} ~ '[^[:space:]]'`),
    check(
      "goals_target_distance_chk",
      sql`${table.targetDistanceM} between 1 and 1000000`,
    ),
    check(
      "goals_target_date_range_chk",
      sql`${table.targetDate} between date '0001-01-01' and date '9999-12-31'`,
    ),
    check(
      "goals_status_chk",
      sql`${table.status} in ('active', 'completed', 'replaced')`,
    ),
    check(
      "goals_completed_at_chk",
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check(
      "goals_replaced_at_chk",
      sql`(${table.status} = 'replaced') = (${table.replacedAt} is not null)`,
    ),
  ],
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    performedOn: date("performed_on", { mode: "string" }).notNull(),
    distanceM: integer("distance_m").notNull(),
    durationS: integer("duration_s").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    // Histórico: mais recente primeiro, com desempate estável (cursor).
    index("workouts_user_history_idx").on(
      table.userId,
      table.performedOn.desc(),
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check("workouts_distance_chk", sql`${table.distanceM} between 1 and 1000000`),
    check("workouts_duration_chk", sql`${table.durationS} between 1 and 172800`),
    check(
      "workouts_performed_on_range_chk",
      sql`${table.performedOn} between date '1970-01-01' and date '9999-12-31'`,
    ),
    check(
      "workouts_notes_chk",
      sql`${table.notes} is null or (char_length(${table.notes}) between 1 and 1000 and ${table.notes} ~ '[^[:space:]]')`,
    ),
  ],
);

/**
 * /api/v1/dashboard — totais de um período, calculados na leitura e só com os
 * treinos do utilizador da sessão.
 */
import { civilDateSchema } from "@runflow/shared";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import express, { type Router } from "express";
import { z } from "zod";
import { authLocals } from "../auth/http.ts";
import type { Database } from "../db/client.ts";
import { workouts } from "../db/schema/index.ts";
import { findActiveGoal } from "../goals/repository.ts";
import { domainGuards, type DomainRouterOptions } from "../http/domain.ts";
import { parseOrThrow } from "../http/validation.ts";
import { methodNotAllowed } from "../problem.ts";

const dashboardQuerySchema = z
  .strictObject({
    from: civilDateSchema,
    to: civilDateSchema,
  })
  .refine((query) => query.from <= query.to, {
    error: "from não pode ser posterior a to.",
    path: ["from"],
  });

export interface PeriodTotals {
  readonly workoutCount: number;
  readonly distanceM: number;
  readonly durationS: number;
  readonly paceSPerKm: number | null;
}

/** Converte um inteiro devolvido como texto; falha (em vez de arredondar) fora do intervalo seguro. */
function safeInteger(text: string, name: string): bigint {
  const value = BigInt(text);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Total ${name} excede o intervalo seguro de inteiros do JavaScript.`);
  }
  return value;
}

/**
 * Ritmo médio ponderado, `round(durationS * 1000 / distanceM)`, em aritmética
 * inteira exata (BigInt). Arredondamento meio para cima (valores sempre positivos),
 * igual a `averagePaceSecondsPerKm` de @runflow/shared.
 */
export function exactPaceSPerKm(durationS: bigint, distanceM: bigint): number | null {
  if (distanceM === 0n) return null;
  return Number((2n * durationS * 1000n + distanceM) / (2n * distanceM));
}

/**
 * Agrega no PostgreSQL: `count`/`sum` de colunas `integer` dão `bigint`, devolvidos
 * como texto (sem passar por float). Só treinos do utilizador, com limites inclusivos.
 */
export async function periodTotals(db: Database, userId: string, from: string, to: string): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      workoutCount: sql<string>`count(*)::text`,
      distanceM: sql<string>`coalesce(sum(${workouts.distanceM}), 0)::text`,
      durationS: sql<string>`coalesce(sum(${workouts.durationS}), 0)::text`,
    })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), gte(workouts.performedOn, from), lte(workouts.performedOn, to)));
  const count = safeInteger(row?.workoutCount ?? "0", "workoutCount");
  const distance = safeInteger(row?.distanceM ?? "0", "distanceM");
  const duration = safeInteger(row?.durationS ?? "0", "durationS");
  return {
    workoutCount: Number(count),
    distanceM: Number(distance),
    durationS: Number(duration),
    paceSPerKm: exactPaceSPerKm(duration, distance),
  };
}

export function createDashboardRouter(options: DomainRouterOptions): Router {
  const { db } = options;
  const router = express.Router();
  router.use(domainGuards(options, "dashboard"));

  router
    .route("/")
    .get(async (req, res) => {
      const { user } = authLocals(res.locals);
      const query = parseOrThrow(dashboardQuerySchema, req.query);
      const [totals, activeGoal] = await Promise.all([
        periodTotals(db, user.id, query.from, query.to),
        findActiveGoal(db, user.id),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        period: { from: query.from, to: query.to, timeZone: user.timeZone },
        activeGoal,
        totals,
      });
    })
    .all(methodNotAllowed(["GET", "HEAD"]));

  return router;
}

/**
 * /api/v1/goals — objetivo ativo do utilizador da sessão (no máximo um).
 * Mesmas proteções das restantes rotas de domínio (ver http/domain.ts).
 */
import {
  compareCivilDates,
  goalInputSchema,
  goalPatchSchema,
  resourceIdSchema,
  todayInTimeZone,
} from "@runflow/shared";
import express, { type Router } from "express";
import { z } from "zod";
import { authLocals } from "../auth/http.ts";
import { domainGuards, type DomainRouterOptions } from "../http/domain.ts";
import { requireJsonBody } from "../http/origin.ts";
import { parseOrThrow, validationError } from "../http/validation.ts";
import { methodNotAllowed, ProblemError } from "../problem.ts";
import {
  completeGoal,
  createGoal,
  findActiveGoal,
  replaceGoal,
  updateGoal,
  type NewGoal,
} from "./repository.ts";

function notFound(): ProblemError {
  // A mesma resposta para objetivo inexistente e objetivo de outro utilizador.
  return new ProblemError(404, "NOT_FOUND", "Objetivo não encontrado.");
}

function parseId(raw: unknown): string {
  const result = resourceIdSchema.safeParse(raw);
  if (!result.success) {
    throw new ProblemError(400, "INVALID_ID", "Identificador de objetivo inválido.");
  }
  return result.data;
}

/** `complete` não tem corpo; se vier algum, só `{}` é aceite. */
const emptyBodySchema = z.strictObject({}).optional();

export function createGoalsRouter(options: DomainRouterOptions): Router {
  const { db, clock } = options;
  const router = express.Router();
  router.use(domainGuards(options, "goals"));

  /** A data-alvo, quando definida ou alterada, não pode ser anterior a hoje no fuso da conta. */
  const assertTargetNotPast = (targetDate: string | null, timeZone: string): void => {
    if (targetDate !== null && compareCivilDates(targetDate, todayInTimeZone(timeZone, clock())) < 0) {
      throw validationError(
        "targetDate",
        "date_in_past",
        "A data-alvo não pode ser anterior a hoje (no seu fuso horário).",
      );
    }
  };

  router
    .route("/active")
    .get(async (_req, res) => {
      const { user } = authLocals(res.locals);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ goal: await findActiveGoal(db, user.id) });
    })
    .all(methodNotAllowed(["GET", "HEAD"]));

  router
    .route("/")
    .post(requireJsonBody, async (req, res) => {
      const { user } = authLocals(res.locals);
      const input: NewGoal = parseOrThrow(goalInputSchema, req.body);
      assertTargetNotPast(input.targetDate, user.timeZone);
      const goal = await createGoal(db, user.id, input);
      res.setHeader("Location", `/api/v1/goals/${goal.id}`);
      res.status(201).json(goal);
    })
    .all(methodNotAllowed(["POST"]));

  router
    .route("/:id")
    .patch(requireJsonBody, async (req, res) => {
      const { user } = authLocals(res.locals);
      const id = parseId(req.params["id"]);
      const patch = parseOrThrow(goalPatchSchema, req.body);
      const updated = await updateGoal(db, user.id, id, patch, (final) => {
        // Só quando a data-alvo é enviada: objetivos vencidos continuam editáveis.
        if (patch.targetDate !== undefined) assertTargetNotPast(final.targetDate, user.timeZone);
      });
      if (!updated) throw notFound();
      res.status(200).json(updated);
    })
    .all(methodNotAllowed(["PATCH"]));

  router
    .route("/:id/complete")
    .post(async (req, res) => {
      const { user } = authLocals(res.locals);
      const id = parseId(req.params["id"]);
      parseOrThrow(emptyBodySchema, req.body);
      const goal = await completeGoal(db, user.id, id, clock());
      if (!goal) throw notFound();
      res.status(200).json(goal);
    })
    .all(methodNotAllowed(["POST"]));

  router
    .route("/:id/replace")
    .post(requireJsonBody, async (req, res) => {
      const { user } = authLocals(res.locals);
      const id = parseId(req.params["id"]);
      const next: NewGoal = parseOrThrow(goalInputSchema, req.body);
      const result = await replaceGoal(db, user.id, id, next, clock(), () => {
        // Só depois de confirmar o dono (para B, o objetivo de A é 404).
        assertTargetNotPast(next.targetDate, user.timeZone);
      });
      if (!result) throw notFound();
      res.setHeader("Location", `/api/v1/goals/${result.current.id}`);
      res.status(201).json(result);
    })
    .all(methodNotAllowed(["POST"]));

  return router;
}

/**
 * /api/v1/workouts — CRUD de treinos do utilizador da sessão.
 *
 * Ordem dos middlewares: rate limiting → origem (escritas) → sessão → rota.
 * O `userId` vem só da sessão; o corpo e a query nunca o definem.
 */
import {
  civilDateSchema,
  isCivilDateInFuture,
  resourceIdSchema,
  workoutInputSchema,
  workoutPatchSchema,
} from "@runflow/shared";
import express, { type Router } from "express";
import { z } from "zod";
import { authLocals } from "../auth/http.ts";
import { domainGuards, type DomainRouterOptions } from "../http/domain.ts";
import { requireJsonBody } from "../http/origin.ts";
import { parseOrThrow, validationError } from "../http/validation.ts";
import { methodNotAllowed, ProblemError } from "../problem.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import {
  createWorkout,
  deleteWorkout,
  findWorkout,
  listWorkouts,
  updateWorkout,
  type NewWorkout,
} from "./repository.ts";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type WorkoutsRouterOptions = DomainRouterOptions;

const listQuerySchema = z
  .strictObject({
    from: civilDateSchema.optional(),
    to: civilDateSchema.optional(),
    limit: z
      .string({ error: "limit tem de ser um número inteiro." })
      .regex(/^[1-9]\d{0,2}$/, { error: `limit tem de estar entre 1 e ${MAX_PAGE_SIZE}.` })
      .transform(Number)
      .refine((value) => value <= MAX_PAGE_SIZE, {
        error: `limit tem de estar entre 1 e ${MAX_PAGE_SIZE}.`,
      })
      .optional(),
    // Estrutura e tamanho (máx. MAX_CURSOR_LENGTH) validados em decodeCursor → INVALID_CURSOR.
    cursor: z.string({ error: "cursor inválido." }).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: "from não pode ser posterior a to.",
    path: ["from"],
  });

function notFound(): ProblemError {
  // A mesma resposta para treino inexistente e treino de outro utilizador.
  return new ProblemError(404, "NOT_FOUND", "Treino não encontrado.");
}

function parseId(raw: unknown): string {
  const result = resourceIdSchema.safeParse(raw);
  if (!result.success) {
    throw new ProblemError(400, "INVALID_ID", "Identificador de treino inválido.");
  }
  return result.data;
}

export function createWorkoutsRouter(options: WorkoutsRouterOptions): Router {
  const { db, clock } = options;
  const router = express.Router();

  router.use(domainGuards(options, "workouts"));

  /** Regra de data futura: depende do fuso do utilizador e do relógio injetado. */
  const assertNotInFuture = (performedOn: string, timeZone: string): void => {
    if (isCivilDateInFuture(performedOn, { timeZone, now: clock() })) {
      throw validationError(
        "performedOn",
        "date_in_future",
        "A data do treino não pode ser posterior a hoje (no seu fuso horário).",
      );
    }
  };

  router
    .route("/")
    .get(async (req, res) => {
      const { user } = authLocals(res.locals);
      const query = parseOrThrow(listQuerySchema, req.query);
      const filters = { from: query.from ?? null, to: query.to ?? null };
      const after = query.cursor === undefined ? null : decodeCursor(query.cursor, filters);
      const page = await listWorkouts(db, user.id, {
        ...filters,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        after,
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        items: page.items,
        nextCursor: page.next ? encodeCursor(page.next, filters) : null,
      });
    })
    .post(requireJsonBody, async (req, res) => {
      const { user } = authLocals(res.locals);
      const input: NewWorkout = parseOrThrow(workoutInputSchema, req.body);
      assertNotInFuture(input.performedOn, user.timeZone);
      const created = await createWorkout(db, user.id, input);
      res.setHeader("Location", `/api/v1/workouts/${created.id}`);
      res.status(201).json(created);
    })
    .all(methodNotAllowed(["GET", "HEAD", "POST"]));

  router
    .route("/:id")
    .get(async (req, res) => {
      const { user } = authLocals(res.locals);
      const workout = await findWorkout(db, user.id, parseId(req.params["id"]));
      if (!workout) throw notFound();
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(workout);
    })
    .patch(requireJsonBody, async (req, res) => {
      const { user } = authLocals(res.locals);
      const id = parseId(req.params["id"]);
      const patch = parseOrThrow(workoutPatchSchema, req.body);
      const updated = await updateWorkout(db, user.id, id, patch, (final) => {
        // Só se a data muda: não bloquear edições de outros campos de um treino
        // de "hoje" quando o utilizador muda para um fuso mais atrasado.
        if (patch.performedOn !== undefined) assertNotInFuture(final.performedOn, user.timeZone);
      });
      if (!updated) throw notFound();
      res.status(200).json(updated);
    })
    .delete(async (req, res) => {
      const { user } = authLocals(res.locals);
      const deleted = await deleteWorkout(db, user.id, parseId(req.params["id"]));
      if (!deleted) throw notFound();
      res.status(204).end();
    })
    .all(methodNotAllowed(["GET", "HEAD", "PATCH", "DELETE"]));

  return router;
}

/**
 * Rota do Vercel Cron para a limpeza de rate limiting (substitui o timer, que não
 * existe numa Vercel Function).
 *
 * - Autenticada: `Authorization: Bearer <CRON_SECRET>`, enviado pela Vercel quando a
 *   variável existe. Comparação em tempo constante (hash SHA-256 de ambos).
 * - Limitada: lotes e número de lotes fixos, para caber no tempo da função; o que
 *   sobrar fica para a execução seguinte.
 * - Idempotente: só apaga registos já expirados (D43). Execuções repetidas ou em
 *   simultâneo (a Vercel pode entregar a mesma execução duas vezes) não fazem mal:
 *   SKIP LOCKED evita esperas e a segunda passagem encontra menos ou nada.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Router } from "express";
import type { Database } from "../db/client.ts";
import { purgeExpiredRateLimits } from "../db/rate-limit-purge.ts";
import { methodNotAllowed, sendProblem } from "../problem.ts";
import type { ApiRateLimitConfig } from "./rate-limit.ts";

export const CRON_PURGE_PATH = "/api/internal/cron/purge-rate-limits";
// Hobby: no máximo uma execução por dia; 20 lotes de 1000 por tabela chegam e
// terminam em segundos.
export const CRON_PURGE_LIMITS = { batchSize: 1000, maxBatches: 20 } as const;

export interface CronOptions {
  readonly secret: string;
  readonly db: Database;
  readonly apiRateLimit: ApiRateLimitConfig;
  readonly clock?: () => Date;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isAuthorizedCron(header: string | undefined, secret: string): boolean {
  if (typeof header !== "string") return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export function createCronRouter(options: CronOptions): Router {
  const router = express.Router();
  const clock = options.clock ?? (() => new Date());

  router
    .route(CRON_PURGE_PATH)
    .get(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!isAuthorizedCron(req.headers.authorization, options.secret)) {
        sendProblem(res, 401, "UNAUTHENTICATED", "Pedido não autorizado.");
        return;
      }
      const result = await purgeExpiredRateLimits(options.db, {
        now: clock(),
        apiRateLimit: options.apiRateLimit,
        ...CRON_PURGE_LIMITS,
      });
      // Só contagens: nada de chaves (que incluem IPs).
      res.status(200).json({
        cutoff: result.cutoff,
        api: result.api,
        auth: result.auth,
      });
    })
    .all(methodNotAllowed(["GET", "HEAD"]));

  return router;
}

import type { RequestHandler } from "express";
import { sendProblem } from "../problem.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Proteção CSRF das escritas de domínio (as proteções do Better Auth só cobrem
 * /api/auth). Pedidos que alteram dados têm de trazer `Origin` igual a uma
 * origem confiável; sem `Origin` (ou `Origin: null`) são recusados, como faz o
 * Better Auth para pedidos com cookie. Um `Sec-Fetch-Site: cross-site` também
 * é recusado. Leituras (GET/HEAD) não alteram estado e não são verificadas.
 */
export function requireTrustedOrigin(trustedOrigins: readonly string[]): RequestHandler {
  const trusted = new Set(trustedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || origin === "null" || origin === "") {
      sendProblem(res, 403, "FORBIDDEN_ORIGIN", "Pedido sem origem válida.");
      return;
    }
    if (!trusted.has(origin) || req.headers["sec-fetch-site"] === "cross-site") {
      sendProblem(res, 403, "FORBIDDEN_ORIGIN", "Origem não autorizada.");
      return;
    }
    next();
  };
}

/**
 * Corpos de escrita têm de ser `application/json`. Além de evitar ambiguidades,
 * impede pedidos "simples" de formulários entre sites (que não podem enviar JSON
 * sem preflight CORS).
 */
export const requireJsonBody: RequestHandler = (req, res, next) => {
  if (!req.is("application/json")) {
    sendProblem(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json.");
    return;
  }
  next();
};

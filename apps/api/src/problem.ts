import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler, RequestHandler, Response } from "express";

/**
 * Erros no formato RFC 9457 (`application/problem+json`).
 *
 * `type` fica `about:blank` (o `title` é a frase HTTP) até existir um domínio
 * para URIs de tipo; os clientes usam o membro de extensão `code`.
 */
export type ProblemCode =
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "LENGTH_REQUIRED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "VALIDATION_ERROR"
  | "INVALID_ID"
  | "INVALID_CURSOR"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "ACTIVE_GOAL_EXISTS"
  | "GOAL_NOT_ACTIVE"
  | "RATE_LIMITED"
  | "INTERNAL";

/**
 * Detalhe de um campo inválido. Indica o campo e um código estável, mas nunca
 * o valor recebido (para não ecoar dados do pedido).
 */
export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: "about:blank";
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly errors?: readonly FieldError[];
  readonly requestId?: string;
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function sendProblem(
  res: Response,
  status: number,
  code: ProblemCode,
  detail: string,
  errors?: readonly FieldError[],
): void {
  const requestId: unknown = res.locals["requestId"];
  const body: ProblemDetails = {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "Error",
    status,
    code,
    detail,
    ...(errors && errors.length > 0 ? { errors } : {}),
    ...(typeof requestId === "string" ? { requestId } : {}),
  };
  res.status(status).type(PROBLEM_CONTENT_TYPE).json(body);
}

/** Erro de domínio lançado pelas rotas e convertido em problem+json pelo error handler. */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly errors: readonly FieldError[] | undefined;

  constructor(status: number, code: ProblemCode, detail: string, errors?: readonly FieldError[]) {
    super(detail);
    this.name = "ProblemError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendProblem(res, 404, "NOT_FOUND", "O recurso pedido não existe.");
};

export function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  return (_req, res) => {
    res.setHeader("Allow", allowed.join(", "));
    sendProblem(res, 405, "METHOD_NOT_ALLOWED", "Método não permitido para este recurso.");
  };
}

/** Tipos de erro emitidos pelo parser JSON do Express (body-parser). */
function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "type" in error) {
    const { type } = error;
    return typeof type === "string" ? type : undefined;
  }
  return undefined;
}

export interface ErrorLogger {
  error(message: string, details: Record<string, unknown>): void;
}

/**
 * Último middleware: converte qualquer erro numa resposta problem+json sem
 * stack trace nem mensagens internas. O detalhe completo vai só para o log.
 */
export function problemErrorHandler(logger: ErrorLogger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ProblemError) {
      sendProblem(res, error.status, error.code, error.message, error.errors);
      return;
    }
    switch (bodyParserErrorType(error)) {
      case "entity.parse.failed":
        sendProblem(res, 400, "INVALID_JSON", "O corpo do pedido não é JSON válido.");
        return;
      case "entity.too.large":
        sendProblem(res, 413, "PAYLOAD_TOO_LARGE", "O corpo do pedido excede o limite permitido.");
        return;
      case "encoding.unsupported":
      case "charset.unsupported":
        sendProblem(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Codificação do corpo não suportada.");
        return;
      default:
        logger.error("Erro não tratado", {
          requestId: res.locals["requestId"],
          method: req.method,
          path: req.path,
          error,
        });
        sendProblem(res, 500, "INTERNAL", "Ocorreu um erro inesperado.");
    }
  };
}

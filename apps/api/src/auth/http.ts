/**
 * Ligação do Better Auth ao Express: handler oficial (`toNodeHandler`), IP do
 * cliente para o rate limiting e `requireSession` para rotas protegidas.
 */
import type { Express, RequestHandler } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { sendProblem } from "../problem.ts";
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, type RunflowAuth } from "./auth.ts";

/** Limite do corpo dos pedidos de autenticação (o handler lê o stream diretamente). */
export const AUTH_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Substitui qualquer valor enviado pelo cliente no cabeçalho interno pelo
 * `req.ip` do Express. Com `trust proxy` desligado (padrão), `req.ip` é o
 * endereço do socket e X-Forwarded-For é ignorado; com proxies configurados,
 * o Express só aceita o X-Forwarded-For desses proxies.
 */
export const clientIpHeader: RequestHandler = (req, _res, next) => {
  Reflect.deleteProperty(req.headers, CLIENT_IP_HEADER);
  if (req.ip) {
    req.headers[CLIENT_IP_HEADER] = req.ip;
  }
  next();
};

/** Recusa corpos grandes antes de chegarem ao Better Auth. */
export const authBodyLimit: RequestHandler = (req, res, next) => {
  const length = req.headers["content-length"];
  if (length !== undefined && Number(length) > AUTH_BODY_LIMIT_BYTES) {
    sendProblem(res, 413, "PAYLOAD_TOO_LARGE", "O corpo do pedido excede o limite permitido.");
    return;
  }
  if (length === undefined && req.headers["transfer-encoding"] !== undefined) {
    sendProblem(res, 411, "LENGTH_REQUIRED", "Indique Content-Length no pedido.");
    return;
  }
  next();
};

/**
 * O Better Auth 1.7.7 responde 429 só com `X-Retry-After` (não normalizado).
 * Sem alterar o handler oficial, acrescenta o cabeçalho padrão `Retry-After`
 * (RFC 9110) com o mesmo valor em segundos, mantendo também o original.
 * O adaptador Node chama `setHeader` para cada cabeçalho e depois `writeHead`.
 */
export const standardRetryAfter: RequestHandler = (_req, res, next) => {
  const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => typeof res;
  res.writeHead = ((statusCode: number, ...rest: unknown[]) => {
    if (statusCode === 429 && !res.hasHeader("retry-after")) {
      const value = res.getHeader("x-retry-after");
      if (value !== undefined) res.setHeader("Retry-After", String(value));
    }
    return originalWriteHead(statusCode, ...rest);
  }) as typeof res.writeHead;
  next();
};

/** Monta o Better Auth em /api/auth, antes de qualquer parser JSON. */
export function mountAuth(app: Express, auth: RunflowAuth): void {
  app.use(AUTH_BASE_PATH, clientIpHeader, authBodyLimit, standardRetryAfter);
  // Express 5: o wildcard tem de ter nome (documentação do Better Auth para Express).
  app.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
}

export interface AuthenticatedLocals {
  readonly user: { id: string; name: string; email: string; timeZone: string };
  readonly session: { id: string; expiresAt: Date };
}

/**
 * Exige uma sessão válida. Em caso de renovação da sessão (`updateAge`), o
 * Better Auth devolve um novo Set-Cookie, que é reencaminhado na resposta.
 */
export function requireSession(auth: RunflowAuth): RequestHandler {
  return async (req, res, next) => {
    const result = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    for (const cookie of result.headers.getSetCookie()) {
      res.append("Set-Cookie", cookie);
    }
    if (!result.response) {
      sendProblem(res, 401, "UNAUTHENTICATED", "Sessão inexistente ou expirada.");
      return;
    }
    const { user, session } = result.response;
    const locals: AuthenticatedLocals = {
      user: { id: user.id, name: user.name, email: user.email, timeZone: user.timeZone },
      session: { id: session.id, expiresAt: session.expiresAt },
    };
    res.locals["auth"] = locals;
    next();
  };
}

export function authLocals(locals: Record<string, unknown>): AuthenticatedLocals {
  const value = locals["auth"];
  if (value === undefined) {
    throw new Error("requireSession tem de correr antes desta rota.");
  }
  return value as AuthenticatedLocals;
}

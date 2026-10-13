/**
 * Cache de dados (TanStack Query). As chaves dos dados privados incluem o id do
 * utilizador; além disso, a cache é limpa por completo no login, no logout e
 * quando a sessão expira, para nunca mostrar dados de outra conta.
 */
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.ts";

export const SESSION_KEY = ["session"] as const;
/** Marcado quando a API devolve 401: a página de login explica que a sessão expirou. */
export const SESSION_EXPIRED_KEY = ["session-expired"] as const;
/** Marcado no logout voluntário: a área protegida vai para /entrar sem `next`. */
export const SIGNED_OUT_KEY = ["signed-out"] as const;

export const userKeys = {
  all: (userId: string) => ["u", userId] as const,
  workouts: (userId: string) => ["u", userId, "workouts"] as const,
  workoutList: (userId: string, from: string, to: string) => ["u", userId, "workouts", "list", from, to] as const,
  workout: (userId: string, id: string) => ["u", userId, "workouts", "item", id] as const,
  goal: (userId: string) => ["u", userId, "goal"] as const,
  dashboard: (userId: string) => ["u", userId, "dashboard"] as const,
  dashboardPeriod: (userId: string, from: string, to: string) => ["u", userId, "dashboard", from, to] as const,
};

function isNotSession(query: { queryKey: readonly unknown[] }): boolean {
  return query.queryKey[0] !== SESSION_KEY[0];
}

/**
 * Marca a sessão como terminada e remove todos os outros dados em cache. Vive aqui
 * (e não em session.ts) para o ficheiro de entrada não importar o cliente Better Auth.
 *
 * A sessão é posta a `null` NA QUERY EXISTENTE (não com `clear()`): o observador
 * da área protegida continua ligado a ela, vê `null` e redireciona, desmontando as
 * páginas. Com `clear()`, esse observador ficava preso à query removida e a página
 * aberta recriava a sua query a cada 401 — um ciclo de pedidos até ao 429.
 */
export function resetToSignedOut(client: QueryClient): void {
  client.setQueryData(SESSION_KEY, null);
  void client.cancelQueries({ predicate: isNotSession });
  client.removeQueries({ predicate: isNotSession });
  client.getMutationCache().clear();
}

let onUnauthorized: () => void = () => undefined;

/** Registado pela app: o que fazer quando a API responde 401 (sessão expirada). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function handleError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) onUnauthorized();
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Erros 4xx (incluindo 401) não são repetidos; falhas de rede/5xx uma vez.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

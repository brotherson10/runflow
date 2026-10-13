/**
 * Sessão (Better Auth) integrada na cache. Regras:
 * - login e logout limpam TODA a cache antes de mostrar dados da nova conta;
 * - um 401 da API (sessão expirada) limpa a cache e marca a sessão como ausente;
 *   a rota protegida redireciona uma única vez para /entrar (sem ciclos).
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { authClient, type AuthErrorLike, type SessionUser } from "./auth-client.ts";
import { resetToSignedOut, SESSION_KEY, SIGNED_OUT_KEY } from "./query.ts";

export interface SessionState {
  readonly user: SessionUser;
}

export class SessionLoadError extends Error {
  constructor() {
    super("Não foi possível verificar a sessão.");
    this.name = "SessionLoadError";
  }
}

async function fetchSession(): Promise<SessionState | null> {
  const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
  if (error) throw new SessionLoadError();
  if (!data) return null;
  const { id, name, email, timeZone } = data.user;
  return { user: { id, name, email, timeZone } };
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
  });
}

export async function signInWithEmail(
  client: QueryClient,
  email: string,
  password: string,
): Promise<AuthErrorLike | null> {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) return error;
  // Nova conta (ou a mesma): nada da sessão anterior pode continuar em cache.
  client.clear();
  await client.query({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 0 });
  return null;
}

export async function signOut(client: QueryClient): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    resetToSignedOut(client);
    client.setQueryData(SIGNED_OUT_KEY, true);
  }
}

/** Atalho para componentes. */
export function useSessionActions() {
  const client = useQueryClient();
  return {
    signIn: (email: string, password: string) => signInWithEmail(client, email, password),
    signOut: () => signOut(client),
    refresh: () => client.invalidateQueries({ queryKey: SESSION_KEY }),
  };
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return Intl.supportedValuesOf("timeZone").includes(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

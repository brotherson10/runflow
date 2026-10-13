/** Base relativa da API: em dev o Vite faz proxy; em produção é a mesma origem. */
export const API_BASE = "/api/v1";

export type ApiStatus = "online" | "offline";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isHealthBody(value: unknown): value is { status: "ok" } {
  return typeof value === "object" && value !== null && "status" in value && value.status === "ok";
}

/** Consulta o health da API. Qualquer falha (rede, HTTP, corpo) conta como offline. */
export async function checkApiHealth(
  fetchFn: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<ApiStatus> {
  try {
    const response = await fetchFn(`${API_BASE}/health`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      return "offline";
    }
    const body: unknown = await response.json();
    return isHealthBody(body) ? "online" : "offline";
  } catch {
    return "offline";
  }
}

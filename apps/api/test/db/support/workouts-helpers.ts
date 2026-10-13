import type { TestClient } from "./auth-harness.ts";

export const W = "/api/v1/workouts";

export interface WorkoutBody {
  id: string;
  performedOn: string;
  distanceM: number;
  durationS: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutPage {
  items: WorkoutBody[];
  nextCursor: string | null;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: { field: string; code: string; message: string }[];
  requestId?: string;
}

export function workoutInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { performedOn: "2026-10-10", distanceM: 5000, durationS: 1500, ...overrides };
}

export async function createWorkoutAs(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<WorkoutBody> {
  const res = await client.post<WorkoutBody>(W, workoutInput(overrides));
  if (res.status !== 201) throw new Error(`Criação falhou: ${String(res.status)} ${res.text}`);
  return res.body;
}

/** Percorre todas as páginas e devolve os ids pela ordem recebida. */
export async function collectAllIds(
  client: TestClient,
  query: Record<string, string> = {},
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const params = new URLSearchParams(query);
    if (cursor) params.set("cursor", cursor);
    const res = await client.get<WorkoutPage>(`${W}?${params.toString()}`);
    if (res.status !== 200) throw new Error(`Listagem falhou: ${String(res.status)} ${res.text}`);
    ids.push(...res.body.items.map((item) => item.id));
    cursor = res.body.nextCursor;
    pages += 1;
    if (pages > 1000) throw new Error("Paginação não terminou.");
  } while (cursor !== null);
  return { ids, pages };
}

/** Um UUID v4 válido que não existe na base. */
export const MISSING_ID = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

/** Verifica que a resposta é problem+json e não expõe detalhes internos. */
export function expectSafeProblem(text: string, contentType: string | null): void {
  if (!contentType?.startsWith("application/problem+json")) {
    throw new Error(`Content-Type inesperado: ${String(contentType)}`);
  }
  const leaks = [/\bat\s+\S+\s+\(/, /node_modules/, /[A-Za-z]:\\/, /\.ts:\d+/, /\bselect\b|\binsert\b|\bupdate\b.*\bset\b/i, /stack/i];
  for (const pattern of leaks) {
    if (pattern.test(text)) throw new Error(`Resposta expõe detalhes internos (${String(pattern)}): ${text}`);
  }
}

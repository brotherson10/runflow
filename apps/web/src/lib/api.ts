/**
 * Cliente da API de domínio (/api/v1), na mesma origem. O browser envia o cookie
 * de sessão e o cabeçalho Origin nas escritas; erros em problem+json passam a
 * `ApiError` com o `code` estável do contrato (docs/api.md).
 */
export const API_BASE = "/api/v1";

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: readonly FieldError[];
  readonly retryAfterS: number | null;

  constructor(status: number, code: string, message: string, errors: readonly FieldError[] = [], retryAfterS: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.retryAfterS = retryAfterS;
  }
}

export interface Workout {
  readonly id: string;
  readonly performedOn: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkoutInput {
  readonly performedOn: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly notes: string | null;
}

export interface WorkoutPage {
  readonly items: Workout[];
  readonly nextCursor: string | null;
}

export type GoalStatus = "active" | "completed" | "replaced";

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly targetDistanceM: number;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly replacedAt: string | null;
}

export interface GoalInput {
  readonly title: string;
  readonly targetDistanceM: number;
  readonly targetDate: string | null;
}

export interface Totals {
  readonly workoutCount: number;
  readonly distanceM: number;
  readonly durationS: number;
  readonly paceSPerKm: number | null;
}

export interface Dashboard {
  readonly period: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly activeGoal: Goal | null;
  readonly totals: Totals;
}

export interface ListFilters {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    field: typeof item["field"] === "string" ? item["field"] : "",
    code: typeof item["code"] === "string" ? item["code"] : "",
    message: typeof item["message"] === "string" ? item["message"] : "",
  }));
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Sem ligação ao servidor. Verifique a ligação e tente novamente.");
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = isRecord(data) ? data : {};
    const retry = Number(response.headers.get("retry-after"));
    throw new ApiError(
      response.status,
      typeof problem["code"] === "string" ? problem["code"] : "HTTP_ERROR",
      typeof problem["detail"] === "string" ? problem["detail"] : "Ocorreu um erro inesperado.",
      toFieldErrors(problem["errors"]),
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return data as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

export const api = {
  workouts: {
    list: (filters: ListFilters, cursor?: string, limit = 20) =>
      request<WorkoutPage>("GET", `/workouts${query({ from: filters.from, to: filters.to, cursor, limit })}`),
    get: (id: string) => request<Workout>("GET", `/workouts/${encodeURIComponent(id)}`),
    create: (input: WorkoutInput) => request<Workout>("POST", "/workouts", input),
    update: (id: string, patch: Partial<WorkoutInput>) =>
      request<Workout>("PATCH", `/workouts/${encodeURIComponent(id)}`, patch),
    remove: (id: string) => request<undefined>("DELETE", `/workouts/${encodeURIComponent(id)}`),
  },
  goals: {
    active: () => request<{ goal: Goal | null }>("GET", "/goals/active"),
    create: (input: GoalInput) => request<Goal>("POST", "/goals", input),
    update: (id: string, patch: Partial<GoalInput>) =>
      request<Goal>("PATCH", `/goals/${encodeURIComponent(id)}`, patch),
    complete: (id: string) => request<Goal>("POST", `/goals/${encodeURIComponent(id)}/complete`, {}),
    replace: (id: string, input: GoalInput) =>
      request<{ previous: Goal; current: Goal }>("POST", `/goals/${encodeURIComponent(id)}/replace`, input),
  },
  dashboard: (from: string, to: string) => request<Dashboard>("GET", `/dashboard${query({ from, to })}`),
};

/** Mensagem do erro de um campo, se a API o indicar. */
export function fieldMessage(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.errors.find((item) => item.field === field)?.message;
}

/** Mensagem geral para mostrar ao utilizador. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return `Demasiados pedidos. Tente novamente${error.retryAfterS ? ` dentro de ${String(error.retryAfterS)} s` : " daqui a pouco"}.`;
    }
    if (error.status >= 500) return "O servidor encontrou um erro. Tente novamente.";
    return error.message;
  }
  return "Ocorreu um erro inesperado.";
}

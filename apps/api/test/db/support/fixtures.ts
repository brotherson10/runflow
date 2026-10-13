import { randomUUID } from "node:crypto";
import type { Database } from "../../../src/db/client.ts";
import { user } from "../../../src/db/schema/index.ts";

/**
 * Cria um utilizador fictício diretamente na tabela do Better Auth.
 * O `id` é tratado como string opaca (formato do Better Auth, não UUID).
 */
export async function insertTestUser(db: Database, label = "corredor"): Promise<string> {
  const id = `test_${randomUUID().replaceAll("-", "")}`;
  await db.insert(user).values({
    id,
    name: `Utilizador ${label}`,
    email: `${id}@example.test`,
    timeZone: "Europe/Lisbon",
  });
  return id;
}

/** Extrai o código SQLSTATE de um erro do PostgreSQL (direto ou embrulhado pelo Drizzle). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** Nome da constraint violada, quando o PostgreSQL o indica. */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

export async function expectPgError(
  operation: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) {
    throw new Error(`Era esperado o erro PostgreSQL ${code}, mas a operação foi aceite.`);
  }
  const actual = pgErrorCode(caught);
  if (actual !== code) {
    throw new Error(`Era esperado o código ${code}, recebido ${String(actual)}.`, { cause: caught });
  }
  if (constraint !== undefined && pgConstraint(caught) !== constraint) {
    throw new Error(
      `Era esperada a constraint ${constraint}, recebida ${String(pgConstraint(caught))}.`,
      { cause: caught },
    );
  }
}

export const SQLSTATE = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  notNullViolation: "23502",
  invalidTextRepresentation: "22P02",
} as const;

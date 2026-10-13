/** Procura um erro do PostgreSQL (direto ou embrulhado pelo Drizzle em `cause`). */
function findPgError(error: unknown): { code?: unknown; constraint?: unknown } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && typeof current.code === "string") {
      return current;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** `true` se o erro for uma violação de unicidade (23505) da constraint/índice indicado. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = findPgError(error);
  return pg?.code === "23505" && pg.constraint === constraint;
}

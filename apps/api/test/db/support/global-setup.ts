import { ensureTestDatabaseExists, getTestDatabaseTarget } from "./test-database.ts";

/** Antes dos testes de base de dados: valida o alvo e cria a base de testes se faltar. */
export default async function setup(): Promise<void> {
  const target = getTestDatabaseTarget();
  try {
    await ensureTestDatabaseExists(target);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PostgreSQL de testes indisponível (${reason}). Arranque-o com \`npm run db:up\`.`,
      { cause: error },
    );
  }
}

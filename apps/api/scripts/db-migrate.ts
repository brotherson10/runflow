// Desenvolvimento: aplica as migrations à base de DATABASE_URL (lê o .env da raiz).
// Uso: npm run db:migrate. A lógica está em src/cli/migrate.ts (também compilada
// para a publicação: npm run db:migrate:deploy).
import "../src/cli/migrate.ts";

// Configuração do drizzle-kit, usada só para GERAR migrations (`npm run db:generate`)
// e verificar a sua consistência (`npm run db:check`).
//
// Sem `dbCredentials` de propósito: o drizzle-kit não liga a nenhuma base.
// `drizzle-kit push` e alterações manuais não fazem parte do fluxo (D14);
// as migrations são aplicadas por `npm run db:migrate` (src/db/migrate.ts).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
});

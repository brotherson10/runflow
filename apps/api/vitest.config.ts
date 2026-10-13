import { configDefaults, defineProject } from "vitest/config";

// Testes unitários da API. Os testes com PostgreSQL real (test/db) correm à parte
// com `npm run test:db` (vitest.db.config.ts na raiz), porque precisam do Docker.
export default defineProject({
  test: {
    name: "@runflow/api",
    environment: "node",
    exclude: [...configDefaults.exclude, "test/db/**"],
  },
});

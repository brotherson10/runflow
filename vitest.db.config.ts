import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
// Lê o .env da raiz (se existir) para o processo de teste; sem .env usa o valor local documentado.
const fileEnv = loadEnv("test", root, "");

const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  fileEnv["TEST_DATABASE_URL"] ??
  "postgres://runflow:runflow_local_dev@127.0.0.1:55432/runflow_test";
// Disponível também para o globalSetup, que corre neste processo.
process.env["TEST_DATABASE_URL"] = TEST_DATABASE_URL;

// Testes com PostgreSQL real. Correm em série: partilham uma única base de testes.
export default defineConfig({
  test: {
    name: "db",
    include: ["apps/api/test/db/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    sequence: { concurrent: false },
    globalSetup: ["apps/api/test/db/support/global-setup.ts"],
    setupFiles: ["apps/api/test/db/support/setup-network.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { TEST_DATABASE_URL },
  },
});

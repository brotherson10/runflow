/**
 * E2E com API e PostgreSQL reais (npm run test:e2e). Requisitos: `npm run db:up`
 * e Google Chrome instalado (usa o canal "chrome": não descarrega browsers).
 *
 * - Topologia de produção: o Express serve o build da web E a API na mesma origem
 *   (localhost:4173), com os cabeçalhos de segurança de produção (sem HSTS: HTTP).
 * - Base `runflow_e2e_test`, limpa a cada execução.
 * - TRUST_PROXY=loopback: o browser liga-se por loopback e cada teste simula um
 *   cliente com IP próprio via X-Forwarded-For, para que os limites de rate
 *   limiting se apliquem por cliente sem serem desligados.
 * - E-mails capturados localmente em .e2e/mail (nada é enviado).
 * - HIBP simulado e rede externa bloqueada na API (e2e/fake-network-preload.ts).
 */
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { MAIL_DIR, WEB_ORIGIN } from "./e2e/constants.ts";

const CI = process.env["CI"] === "true";
const DB_URL =
  process.env["E2E_DATABASE_URL"] ?? "postgres://runflow:runflow_local_dev@127.0.0.1:55432/runflow_e2e_test";
// Absoluto, calculado a partir deste ficheiro: não depende da pasta de arranque.
const WEB_DIST_DIR = resolve(import.meta.dirname, "apps", "web", "dist");

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Sem retries: uma falha intermitente tem de ser vista, não escondida.
  retries: 0,
  forbidOnly: CI,
  outputDir: "test-results",
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    channel: "chrome",
    headless: true,
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    // Só em falhas: trace (rede, DOM, consola) e captura de ecrã ficam em test-results/.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: [
      "npm run build --workspace @runflow/shared",
      "npm run build --workspace @runflow/web",
      "node --conditions=development e2e/prepare-db.ts",
      "node --import ./e2e/fake-network-preload.ts --conditions=development apps/api/src/server.ts",
    ].join(" && "),
    url: `${WEB_ORIGIN}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      PORT: new URL(WEB_ORIGIN).port,
      DATABASE_URL: DB_URL,
      E2E_DATABASE_URL: DB_URL,
      APP_URL: WEB_ORIGIN,
      BETTER_AUTH_SECRET: "runflow-e2e-secret-local-only-0123456789abcdef",
      TRUST_PROXY: "loopback",
      MAIL_TRANSPORT: "local",
      MAIL_OUTBOX_DIR: MAIL_DIR,
      PASSWORD_BREACH_CHECK: "hibp",
      WEB_DIST_DIR,
    },
  },
});

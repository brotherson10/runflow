import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { securityHeaders } from "@runflow/shared";
import { describe, expect, it, vi } from "vitest";
import { readServerConfig } from "../src/config.ts";
import { CRON_PURGE_PATH, isAuthorizedCron } from "../src/http/cron.ts";
import { createVercelApp } from "../src/vercel-app.ts";

interface VercelRoute {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  handle?: string;
}

interface VercelConfig {
  routes: VercelRoute[];
  crons: { path: string; schedule: string }[];
  functions: Record<string, { maxDuration: number }>;
  outputDirectory: string;
  buildCommand: string;
}

const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as VercelConfig;
const matches = (route: VercelRoute, path: string) => route.src !== undefined && new RegExp(`^${route.src}$`).test(path);

/**
 * Destino de um caminho que não existe como ficheiro estático (as rotas depois de
 * `handle: filesystem`). `routes` com `dest` fixo: a função recebe o URL original,
 * sem parâmetros acrescentados à query (o que `rewrites` com parâmetros faria).
 */
function destinationFor(path: string): string | null {
  const afterFilesystem = vercel.routes.slice(vercel.routes.findIndex((route) => route.handle === "filesystem") + 1);
  return afterFilesystem.find((route) => matches(route, path))?.dest ?? null;
}

describe("vercel.json", () => {
  it("cabeçalhos de segurança das páginas = fonte única (HTTPS)", () => {
    const pages = vercel.routes.find((route) => route.headers?.["Content-Security-Policy"] !== undefined);
    expect(pages?.continue).toBe(true);
    const { "Cache-Control": cache, ...configured } = pages?.headers ?? {};
    expect(configured).toEqual(securityHeaders({ https: true }));
    expect(cache).toBe("no-cache");
    // As respostas da API levam os cabeçalhos do Express (não duplicados aqui).
    expect(pages && matches(pages, "/api/v1/health")).toBe(false);
    expect(pages && matches(pages, "/app/treinos")).toBe(true);
  });

  it("assets com hash: cache imutável (regra depois da das páginas, para prevalecer)", () => {
    const index = vercel.routes.findIndex((route) => route.src === "/assets/(.*)");
    expect(index).toBeGreaterThan(0);
    expect(vercel.routes[index]?.headers).toEqual({ "Cache-Control": "public, max-age=31536000, immutable" });
    expect(vercel.routes.every((route) => !route.dest?.includes("?"))).toBe(true);
  });

  it.each([
    ["/api", "/api"],
    ["/api/v1/health", "/api"],
    ["/api/auth/sign-in/email", "/api"],
    ["/API/v1/nada", "/api"],
    ["/Api", "/api"],
    [CRON_PURGE_PATH, "/api"],
    ["/app/treinos", "/index.html"],
    ["/confirmar-email", "/index.html"],
    ["/demo/objetivo", "/index.html"],
    ["/apps", "/index.html"],
    ["/assets/nao-existe.js", null],
    ["/favicon.ico", null],
    ["/app/foto.png", null],
  ])("destino de %s → %s", (path, destination) => {
    expect(destinationFor(path)).toBe(destination);
  });

  it("cron diário (Hobby) na rota autenticada, função com duração limitada, build e saída corretos", () => {
    expect(vercel.crons).toEqual([{ path: CRON_PURGE_PATH, schedule: expect.stringMatching(/^\d{1,2} \d{1,2} \* \* \*$/) as string }]);
    expect(vercel.functions["api/index.mjs"]?.maxDuration).toBeLessThanOrEqual(60);
    expect(vercel.outputDirectory).toBe("apps/web/dist");
    expect(vercel.buildCommand).toBe("npm run build");
  });

  it("a função reexporta o build da entrada da Vercel", () => {
    const entry = readFileSync(new URL("../../../api/index.mjs", import.meta.url), "utf8");
    expect(entry).toMatch(/export \{ default \} from "\.\.\/apps\/api\/dist\/vercel\.js";/);
  });
});

describe("configuração na Vercel", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@db.example.test:5432/neondb",
    BETTER_AUTH_SECRET: "s".repeat(40),
    APP_URL: "https://runflow.example",
    TRUST_PROXY: "1",
    CRON_SECRET: "c".repeat(40),
  };

  it("sem build da web nem timer de limpeza; cron obrigatório", () => {
    const config = readServerConfig({ ...production, WEB_DIST_DIR: "/qualquer", RATE_LIMIT_PURGE_INTERVAL_S: "3600" }, undefined, "vercel");
    expect(config).toMatchObject({ webDistDir: null, rateLimitPurgeIntervalS: 0, cronSecret: production.CRON_SECRET, trustProxy: 1 });
  });

  it.each([
    ["sem CRON_SECRET", { CRON_SECRET: undefined }, /CRON_SECRET é obrigatória/],
    ["CRON_SECRET curto", { CRON_SECRET: "curto" }, /pelo menos 32/],
    ["sem TRUST_PROXY", { TRUST_PROXY: undefined }, /TRUST_PROXY é obrigatório na Vercel/],
  ])("%s → erro", (_label, override, message) => {
    expect(() => readServerConfig({ ...production, ...override }, undefined, "vercel")).toThrow(message);
  });

  it("fora da Vercel, CRON_SECRET é opcional e o comportamento anterior mantém-se", () => {
    const env: Record<string, string | undefined> = { ...production, CRON_SECRET: undefined };
    const config = readServerConfig(env);
    expect(config.cronSecret).toBeNull();
    expect(config.webDistDir).not.toBeNull();
  });

  it("configuração inválida: a função responde 503 sem detalhes e o log não tem segredos", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const app = createVercelApp({ ...production, CRON_SECRET: "segredo-curto-nao-revelar" });
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`);
      const text = await res.text();
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toMatch(/problem\+json/);
      expect(text).not.toMatch(/CRON|segredo|secret/i);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).toMatch(/CRON_SECRET/);
    expect(errors.join("\n")).not.toContain("segredo-curto-nao-revelar");
    expect(errors.join("\n")).not.toContain(production.BETTER_AUTH_SECRET);
  });
});

describe("autenticação do cron", () => {
  const secret = "segredo-do-cron-com-mais-de-32-caracteres";
  it.each([
    [undefined, false],
    ["", false],
    [secret, false],
    [`Basic ${secret}`, false],
    [`Bearer ${secret}x`, false],
    [`Bearer ${secret.slice(0, -1)}`, false],
    [`bearer ${secret}`, false],
    [`Bearer ${secret}`, true],
  ])("%j → %s", (header, expected) => {
    expect(isAuthorizedCron(header, secret)).toBe(expected);
  });
});

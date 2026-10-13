import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { DEFAULT_WEB_DIST_DIR } from "../src/config.ts";
import { ASSET_CACHE_CONTROL, loadWebBuild, PAGE_CACHE_CONTROL } from "../src/http/web.ts";

const INDEX = "<!doctype html><title>RunFlow</title><div id=root></div>";
const ASSET = "console.log('runflow');";

let root: string;
let dist: string;

function makeBuild(): void {
  root = mkdtempSync(join(tmpdir(), "runflow-web-"));
  dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(join(dist, "assets", "index-abc123.js"), ASSET);
  writeFileSync(join(dist, ".env"), "SEGREDO=nao-servir");
  // Fora da pasta servida: nunca pode ser lido por path traversal.
  writeFileSync(join(root, "segredo.txt"), "fora-da-pasta");
}

async function listen(https: boolean): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(createApp({ logger: { error: () => undefined }, web: loadWebBuild(dist), https }));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${String(port)}` };
}

function close(server: Server): Promise<void> {
  return new Promise((done, fail) => {
    server.close((error) => {
      if (error) fail(error);
      else done();
    });
  });
}

describe("build da web servido pelo Express (mesma origem)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    makeBuild();
    ({ server, baseUrl } = await listen(false));
  });

  afterAll(async () => {
    await close(server);
    rmSync(root, { recursive: true, force: true });
  });

  it.each(["/", "/entrar", "/app", "/app/treinos/6f9619ff-8b86-4011-b42d-00c04fc964ff/editar", "/demo/objetivo"])(
    "rota direta %s → index.html com CSP e no-cache",
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Accept: "text/html" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(await res.text()).toBe(INDEX);
      expect(res.headers.get("cache-control")).toBe(PAGE_CACHE_CONTROL);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("upgrade-insecure-requests");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("strict-transport-security")).toBeNull();
    },
  );

  it("assets com hash: cache imutável; HEAD sem corpo", async () => {
    const res = await fetch(`${baseUrl}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(await res.text()).toBe(ASSET);
    const head = await fetch(`${baseUrl}/app`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it.each(["/assets/nao-existe.js", "/favicon.ico", "/app/foto.png", "/robots.txt"])(
    "asset inexistente %s → 404 (nunca index.html)",
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("<title>RunFlow</title>");
    },
  );

  it.each(["/api", "/api/", "/api/nada", "/api/v1/nada", "/API/v1/nada", "/Api/qualquer"])(
    "%s → 404 problem+json (sem fallback SPA)",
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Accept: "text/html" } });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).not.toContain("<title>RunFlow</title>");
    },
  );

  it.each(["POST", "PUT", "DELETE"])("%s numa página → 404 (fallback só em GET/HEAD)", async (method) => {
    const res = await fetch(`${baseUrl}/app/treinos`, { method });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<title>RunFlow</title>");
  });

  it.each(["/.env", "/assets/../../segredo.txt", "/%2e%2e/segredo.txt", "/assets/%2e%2e/%2e%2e/segredo.txt", "/..%2fsegredo.txt"])(
    "%s não expõe ficheiros",
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      const text = await res.text();
      expect(text).not.toContain("fora-da-pasta");
      expect(text).not.toContain("nao-servir");
    },
  );

  it("a API mantém-se: health com no-store e os mesmos cabeçalhos de segurança", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("HTTPS (produção)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    makeBuild();
    ({ server, baseUrl } = await listen(true));
  });

  afterAll(async () => {
    await close(server);
    rmSync(root, { recursive: true, force: true });
  });

  it("acrescenta HSTS (sem includeSubDomains) e upgrade-insecure-requests", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(res.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });
});

describe("validação da pasta do build", () => {
  it("recusa caminho relativo, pasta inexistente e pasta sem index.html", () => {
    const empty = mkdtempSync(join(tmpdir(), "runflow-vazio-"));
    try {
      expect(() => loadWebBuild("apps/web/dist")).toThrow(/absoluto/);
      expect(() => loadWebBuild(join(empty, "nao-existe"))).toThrow(/não encontrado/);
      expect(() => loadWebBuild(empty)).toThrow(/sem index.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("a pasta por omissão é calculada a partir do código, não da pasta de arranque", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(DEFAULT_WEB_DIST_DIR).toBe(resolve(repoRoot, "apps", "web", "dist"));
    expect(DEFAULT_WEB_DIST_DIR).not.toBe(resolve(process.cwd(), "dist"));
  });
});

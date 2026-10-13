import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { PROBLEM_CONTENT_TYPE, problemErrorHandler } from "../src/problem.ts";

/** Sinais de fuga de detalhes internos que nunca devem chegar ao cliente. */
function expectNoInternals(text: string): void {
  expect(text).not.toMatch(/\bat\s+\S+\s+\(/); // linhas de stack trace
  expect(text).not.toMatch(/node_modules|[A-Za-z]:\\|\/src\/|\.ts:\d+/);
  expect(text).not.toMatch(/SyntaxError|TypeError|PayloadTooLargeError|stack/i);
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${String(port)}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

describe("API base", () => {
  const logger = { error: vi.fn() };
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await listen(createApp({ logger })));
  });

  afterAll(async () => {
    await close(server);
  });

  it("GET /api/v1/health indica só a disponibilidade do processo", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("HEAD /api/v1/health responde 200", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("não envia X-Powered-By e envia nosniff", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.headers.has("x-powered-by")).toBe(false);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["/api/v1/nao-existe", "/api/v1/runners/1", "/", "/qualquer"])(
    "404 em problem+json para %s",
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      const text = await res.text();
      expectNoInternals(text);
      const body: unknown = JSON.parse(text);
      expect(body).toMatchObject({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "NOT_FOUND",
      });
      expect(body).toHaveProperty("requestId", res.headers.get("x-request-id"));
    },
  );

  it("405 com Allow para métodos não suportados em /health", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(await res.json()).toMatchObject({ code: "METHOD_NOT_ALLOWED", status: 405 });
  });

  it.each(['{"name":"x",', "{bad", "null", '"texto"'])(
    "JSON inválido %j dá 400 INVALID_JSON sem stack",
    async (payload) => {
      const res = await fetch(`${baseUrl}/api/v1/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      const text = await res.text();
      expectNoInternals(text);
      expect(JSON.parse(text)).toMatchObject({ code: "INVALID_JSON", status: 400 });
    },
  );

  it("JSON inválido em rota inexistente também dá 400 (parse antes do 404)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/nao-existe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expectNoInternals(await res.text());
  });

  it("body acima de 16 kB dá 413 PAYLOAD_TOO_LARGE sem stack", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "x".repeat(17 * 1024) }),
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expectNoInternals(text);
    expect(JSON.parse(text)).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("charset não suportado dá 415", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=klingon" },
      body: "{}",
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("nenhum dos casos acima foi registado como erro interno", () => {
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("problemErrorHandler", () => {
  it("erro inesperado dá 500 genérico; o detalhe só vai para o log", async () => {
    const logger = { error: vi.fn() };
    const app = express();
    app.get("/boom", () => {
      throw new Error("segredo interno: ligação à BD falhou em /srv/app/db.ts:42");
    });
    app.get("/async-boom", async () => {
      await Promise.resolve();
      throw new TypeError("falha assíncrona");
    });
    app.use(problemErrorHandler(logger));
    const { server, baseUrl } = await listen(app);
    try {
      for (const path of ["/boom", "/async-boom"]) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status).toBe(500);
        expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
        const text = await res.text();
        expectNoInternals(text);
        expect(text).not.toContain("segredo");
        expect(text).not.toContain("falha assíncrona");
        expect(JSON.parse(text)).toMatchObject({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          code: "INTERNAL",
        });
      }
      expect(logger.error).toHaveBeenCalledTimes(2);
    } finally {
      await close(server);
    }
  });

  it("usa o tipo de conteúdo problem+json", () => {
    expect(PROBLEM_CONTENT_TYPE).toBe("application/problem+json");
  });
});

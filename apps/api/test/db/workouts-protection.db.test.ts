import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  AUTH,
  nextClientIp,
  signedInClient,
  startAuthServer,
  TestClient,
  UNTRUSTED_ORIGIN,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import {
  createWorkoutAs,
  W,
  workoutInput,
  type ProblemBody,
  type WorkoutBody,
} from "./support/workouts-helpers.ts";

let now = new Date("2026-10-12T11:00:00Z");

/** Cliente com o cookie de `source`, mas outra origem/IP. */
function withCookies(source: TestClient, options: ConstructorParameters<typeof TestClient>[1]): TestClient {
  const client = new TestClient(source.baseUrl, options);
  for (const [name, value] of source.cookies) client.cookies.set(name, value);
  return client;
}

describe("proteção de origem (CSRF) nas escritas de domínio", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  let client: TestClient;
  let workout: WorkoutBody;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => now });
    ({ client } = await signedInClient(server));
    workout = await createWorkoutAs(client, { notes: "intacto" });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  const writes = [
    ["POST", W, workoutInput({ notes: "atacante" })],
    ["PATCH", "item", { notes: "atacante" }],
    ["DELETE", "item", undefined],
  ] as const;

  it.each([
    ["origem maliciosa", { origin: UNTRUSTED_ORIGIN }, {}],
    ["sem Origin", { origin: null }, {}],
    ["Origin: null", { origin: "null" }, {}],
    ["Sec-Fetch-Site: cross-site", {}, { "Sec-Fetch-Site": "cross-site" }],
  ])("%s: escritas recusadas com 403 e sem efeito", async (_label, clientOptions, headers) => {
    const attacker = withCookies(client, clientOptions);
    for (const [method, target, body] of writes) {
      const path = target === "item" ? `${W}/${workout.id}` : target;
      const res = await attacker.request<ProblemBody>(method, path, body, headers);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN_ORIGIN");
    }
    const read = await client.get<WorkoutBody>(`${W}/${workout.id}`);
    expect(read.body).toEqual(workout);
    const { rowCount } = await handle.pool.query("select 1 from workouts where notes = 'atacante'");
    expect(rowCount).toBe(0);
  });

  it("leituras não exigem Origin (não alteram estado)", async () => {
    const reader = withCookies(client, { origin: null });
    expect((await reader.get(`${W}/${workout.id}`)).status).toBe(200);
    expect((await reader.get(W)).status).toBe(200);
  });
});

describe("rate limiting das rotas de domínio", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  const limits = { read: { windowS: 60, max: 5 }, write: { windowS: 60, max: 3 } };

  it("escritas: 3 por janela, depois 429 com Retry-After; nova janela volta a permitir", async () => {
    now = new Date("2026-10-12T11:00:00Z");
    const server = await startAuthServer(handle, { clock: () => now, apiRateLimit: limits });
    try {
      const { client } = await signedInClient(server);
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await client.post(W, workoutInput())).status);
      expect(statuses).toEqual([201, 201, 201, 429]);

      const blocked = await client.post<ProblemBody>(W, workoutInput());
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
      expect(blocked.headers.get("retry-after")).toBe("60");

      now = new Date(now.getTime() + 30_000);
      expect((await client.post(W, workoutInput())).headers.get("retry-after")).toBe("30");

      // As leituras têm um limite próprio.
      expect((await client.get(W)).status).toBe(200);

      now = new Date(now.getTime() + 31_000);
      expect((await client.post(W, workoutInput())).status).toBe(201);
    } finally {
      await server.close();
    }
  });

  it("leituras: 5 por janela; cada cliente (IP) tem o seu contador", async () => {
    now = new Date("2026-10-12T12:00:00Z");
    const server = await startAuthServer(handle, { clock: () => now, apiRateLimit: limits });
    try {
      const { client } = await signedInClient(server);
      const statuses = [];
      for (let i = 0; i < 6; i++) statuses.push((await client.get(W)).status);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
      const otherIp = withCookies(client, { forwardedFor: nextClientIp() });
      expect((await otherIp.get(W)).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("sem proxy confiável, X-Forwarded-For forjado não contorna o limite", async () => {
    now = new Date("2026-10-12T13:00:00Z");
    const server = await startAuthServer(handle, { clock: () => now, apiRateLimit: limits, trustProxy: false });
    try {
      const { client } = await signedInClient(server);
      for (let i = 0; i < 5; i++) await client.get(W);
      for (const spoofed of ["203.0.113.10", "203.0.113.11"]) {
        const res = await withCookies(client, { forwardedFor: spoofed }).get(W);
        expect(res.status).toBe(429);
      }
    } finally {
      await server.close();
    }
  });

  it("o estado fica em api_rate_limit e sobrevive a um reinício da API", async () => {
    now = new Date("2026-10-12T14:00:00Z");
    const ip = nextClientIp();
    const first = await startAuthServer(handle, { clock: () => now, apiRateLimit: limits });
    let cookies: TestClient;
    try {
      const { client } = await signedInClient(first);
      client.forwardedFor = ip;
      for (let i = 0; i < 5; i++) await client.get(W);
      cookies = client;
    } finally {
      await first.close();
    }
    const { rows } = await handle.pool.query<{ count: number }>(
      "select count from api_rate_limit where key = $1",
      [`workouts:read|${ip}`],
    );
    expect(rows[0]?.count).toBe(5);

    const restarted = await startAuthServer(handle, { clock: () => now, apiRateLimit: limits });
    try {
      const again = new TestClient(restarted.baseUrl, { forwardedFor: ip });
      for (const [name, value] of cookies.cookies) again.cookies.set(name, value);
      expect((await again.get(W)).status).toBe(429);
    } finally {
      await restarted.close();
    }
  });
});

describe("429 do Better Auth: Retry-After padrão", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle);
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("envia Retry-After com o mesmo valor do X-Retry-After original", async () => {
    const client = new TestClient(server.baseUrl);
    let last;
    for (let i = 0; i < 6; i++) {
      last = await client.post(`${AUTH}/sign-in/email`, {
        email: "ninguem@example.test",
        password: "palavra-errada-123",
      });
    }
    expect(last?.status).toBe(429);
    const standard = last?.headers.get("retry-after");
    expect(standard).toMatch(/^\d+$/);
    expect(standard).toBe(last?.headers.get("x-retry-after"));
  });

  it("respostas que não são 429 não recebem Retry-After", async () => {
    const res = await new TestClient(server.baseUrl).get(`${AUTH}/get-session`);
    expect(res.headers.has("retry-after")).toBe(false);
  });
});

import { LIMITS } from "@runflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  SESSION_COOKIE,
  signedInClient,
  startAuthServer,
  TestClient,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import {
  createWorkoutAs,
  expectSafeProblem,
  MISSING_ID,
  W,
  workoutInput,
  type ProblemBody,
  type WorkoutBody,
  type WorkoutPage,
} from "./support/workouts-helpers.ts";

// Relógio fixo: 2026-10-12 em Lisboa (fuso dos utilizadores de teste).
const NOW = new Date("2026-10-12T11:00:00Z");

describe("CRUD de treinos (HTTP + PostgreSQL)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => NOW });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("ciclo completo: criar, ler, listar, alterar e eliminar", async () => {
    const { client, userId } = await signedInClient(server);

    const created = await client.post<WorkoutBody>(W, workoutInput({ notes: "  Rodagem leve  " }));
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`${W}/${created.body.id}`);
    expect(created.body).toMatchObject({
      performedOn: "2026-10-10",
      distanceM: 5000,
      durationS: 1500,
      notes: "Rodagem leve",
    });
    expect(Object.keys(created.body).sort()).toEqual(
      ["createdAt", "distanceM", "durationS", "id", "notes", "performedOn", "updatedAt"].sort(),
    );
    const id = created.body.id;

    const { rows } = await handle.pool.query<{ user_id: string; performed_on: string }>(
      "select user_id, performed_on::text from workouts where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ user_id: userId, performed_on: "2026-10-10" });

    const read = await client.get<WorkoutBody>(`${W}/${id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);

    const list = await client.get<WorkoutPage>(W);
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.id)).toEqual([id]);
    expect(list.body.nextCursor).toBeNull();

    const patched = await client.patch<WorkoutBody>(`${W}/${id}`, { distanceM: 8000, notes: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ id, distanceM: 8000, durationS: 1500, notes: null });
    expect(Date.parse(patched.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.body.updatedAt));

    const removed = await client.delete(`${W}/${id}`);
    expect(removed.status).toBe(204);
    expect(removed.text).toBe("");
    expect((await client.get(`${W}/${id}`)).status).toBe(404);
    const { rowCount } = await handle.pool.query("select 1 from workouts where id = $1", [id]);
    expect(rowCount).toBe(0);
  });

  it("os dados persistem após reiniciar a API", async () => {
    const { client } = await signedInClient(server);
    const workout = await createWorkoutAs(client, { notes: "persistente" });
    const restarted = await startAuthServer(handle, { clock: () => NOW });
    try {
      const again = new TestClient(restarted.baseUrl);
      for (const [name, value] of client.cookies) again.cookies.set(name, value);
      const res = await again.get<WorkoutBody>(`${W}/${workout.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(workout);
    } finally {
      await restarted.close();
    }
  });

  it("dois treinos com os mesmos valores são permitidos", async () => {
    const { client } = await signedInClient(server);
    const first = await createWorkoutAs(client);
    const second = await createWorkoutAs(client);
    expect(first.id).not.toBe(second.id);
  });

  it("guarda strings HTML literalmente (a API não faz escape; a interface ainda não existe)", async () => {
    const { client } = await signedInClient(server);
    const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const created = await createWorkoutAs(client, { notes: html });
    expect(created.notes).toBe(html);
    const read = await client.get<WorkoutBody>(`${W}/${created.id}`);
    expect(read.headers.get("content-type")).toMatch(/^application\/json/);
    expect(read.body.notes).toBe(html);
    const { rows } = await handle.pool.query<{ notes: string }>("select notes from workouts where id = $1", [
      created.id,
    ]);
    expect(rows[0]?.notes).toBe(html);
  });

  describe("sem sessão", () => {
    it.each([
      ["GET lista", "GET", W],
      ["POST", "POST", W],
      ["GET item", "GET", `${W}/${MISSING_ID}`],
      ["PATCH", "PATCH", `${W}/${MISSING_ID}`],
      ["DELETE", "DELETE", `${W}/${MISSING_ID}`],
    ])("%s devolve 401", async (_label, method, path) => {
      for (const cookie of [undefined, `${SESSION_COOKIE}=forjado.assinatura`]) {
        const client = new TestClient(server.baseUrl);
        const res = await client.request<ProblemBody>(
          method,
          path,
          method === "POST" || method === "PATCH" ? workoutInput() : undefined,
          cookie ? { Cookie: cookie } : {},
        );
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHENTICATED");
        expectSafeProblem(res.text, res.headers.get("content-type"));
      }
      expect((await handle.pool.query("select 1 from workouts where notes = 'anon'")).rowCount).toBe(0);
    });
  });

  describe("validação na criação", () => {
    let client: TestClient;

    beforeAll(async () => {
      ({ client } = await signedInClient(server));
    });

    it("aceita os limites inclusivos", async () => {
      const created = await createWorkoutAs(client, {
        performedOn: LIMITS.minWorkoutDate,
        distanceM: LIMITS.distanceM.max,
        durationS: LIMITS.durationS.max,
        notes: "x".repeat(LIMITS.notesMaxLength),
      });
      expect(created.distanceM).toBe(LIMITS.distanceM.max);
      const minimal = await createWorkoutAs(client, { distanceM: 1, durationS: 1, notes: "   " });
      expect(minimal.notes).toBeNull();
    });

    it.each([
      ["corpo vazio", {}, "performedOn"],
      ["userId no corpo", workoutInput({ userId: "outro-utilizador" }), "userId"],
      ["id no corpo", workoutInput({ id: MISSING_ID }), "id"],
      ["createdAt no corpo", workoutInput({ createdAt: "2020-01-01T00:00:00Z" }), "createdAt"],
      ["distância em texto", workoutInput({ distanceM: "5000" }), "distanceM"],
      ["distância decimal", workoutInput({ distanceM: 5000.5 }), "distanceM"],
      ["distância 0", workoutInput({ distanceM: 0 }), "distanceM"],
      ["distância acima do máximo", workoutInput({ distanceM: LIMITS.distanceM.max + 1 }), "distanceM"],
      ["duração negativa", workoutInput({ durationS: -1 }), "durationS"],
      ["duração acima do máximo", workoutInput({ durationS: LIMITS.durationS.max + 1 }), "durationS"],
      ["duração booleana", workoutInput({ durationS: true }), "durationS"],
      ["data inexistente", workoutInput({ performedOn: "2026-02-30" }), "performedOn"],
      ["data com hora", workoutInput({ performedOn: "2026-10-10T08:00:00Z" }), "performedOn"],
      ["data antes de 1970", workoutInput({ performedOn: "1969-12-31" }), "performedOn"],
      ["notas longas", workoutInput({ notes: "x".repeat(LIMITS.notesMaxLength + 1) }), "notes"],
      ["notas numéricas", workoutInput({ notes: 42 }), "notes"],
      ["array em vez de objeto", [workoutInput()], "(body)"],
    ])("rejeita %s", async (_label, body, field) => {
      const before = await handle.pool.query("select count(*)::int as n from workouts");
      const res = await client.post<ProblemBody>(W, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.map((error) => error.field)).toContain(field);
      expectSafeProblem(res.text, res.headers.get("content-type"));
      const after = await handle.pool.query("select count(*)::int as n from workouts");
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it("não ecoa o valor recebido nos erros", async () => {
      const res = await client.post<ProblemBody>(W, workoutInput({ distanceM: "VALOR-SECRETO-123" }));
      expect(res.status).toBe(400);
      expect(res.text).not.toContain("VALOR-SECRETO-123");
    });

    it("JSON inválido: 400 INVALID_JSON", async () => {
      const res = await client.request<ProblemBody>("POST", W, '{"performedOn":', {});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_JSON");
      expectSafeProblem(res.text, res.headers.get("content-type"));
    });

    it("Content-Type que não é JSON: 415", async () => {
      const res = await client.request<ProblemBody>("POST", W, undefined, {
        "Content-Type": "text/plain",
      });
      expect(res.status).toBe(415);
      expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("corpo acima de 16 kB: 413", async () => {
      const res = await client.post<ProblemBody>(W, workoutInput({ notes: "x".repeat(17 * 1024) }));
      expect(res.status).toBe(413);
      expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("método não suportado: 405", async () => {
      const res = await client.request<ProblemBody>("PUT", W, workoutInput());
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD, POST");
    });
  });

  describe("PATCH", () => {
    let client: TestClient;
    let workout: WorkoutBody;

    beforeAll(async () => {
      ({ client } = await signedInClient(server));
      workout = await createWorkoutAs(client, { notes: "original" });
    });

    it("PATCH vazio é recusado", async () => {
      const res = await client.patch<ProblemBody>(`${W}/${workout.id}`, {});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it.each([
      ["userId", { userId: "outro" }],
      ["id", { id: MISSING_ID }],
      ["distância inválida", { distanceM: 0 }],
      ["data inexistente", { performedOn: "2026-13-01" }],
      ["notas longas", { notes: "x".repeat(LIMITS.notesMaxLength + 1) }],
    ])("rejeita %s sem alterar o treino", async (_label, body) => {
      const res = await client.patch<ProblemBody>(`${W}/${workout.id}`, body);
      expect(res.status).toBe(400);
      const read = await client.get<WorkoutBody>(`${W}/${workout.id}`);
      expect(read.body).toEqual(workout);
    });

    it("altera só os campos enviados e valida o resultado final", async () => {
      const res = await client.patch<WorkoutBody>(`${W}/${workout.id}`, { durationS: 1800 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        performedOn: workout.performedOn,
        distanceM: workout.distanceM,
        durationS: 1800,
        notes: "original",
      });
    });
  });

  describe("identificadores", () => {
    it.each(["1", "1.0", "abc", "6F9619FF-8B86-4011-B42D-00C04FC964FF", "6f9619ff8b864011b42d00c04fc964ff"])(
      "id %j inválido: 400 INVALID_ID em GET, PATCH e DELETE",
      async (id) => {
        const { client } = await signedInClient(server);
        for (const method of ["GET", "PATCH", "DELETE"]) {
          const res = await client.request<ProblemBody>(
            method,
            `${W}/${encodeURIComponent(id)}`,
            method === "PATCH" ? { distanceM: 1000 } : undefined,
          );
          expect(res.status).toBe(400);
          expect(res.body.code).toBe("INVALID_ID");
        }
      },
    );

    it("UUID válido inexistente: 404", async () => {
      const { client } = await signedInClient(server);
      const res = await client.get<ProblemBody>(`${W}/${MISSING_ID}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });
});

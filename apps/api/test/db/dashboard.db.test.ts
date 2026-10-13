import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  signedInClient,
  startAuthServer,
  TestClient,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import { createWorkoutAs, W, type ProblemBody, type WorkoutBody } from "./support/workouts-helpers.ts";

const D = "/api/v1/dashboard";
const NOW = new Date("2026-10-12T11:00:00Z");

interface Dashboard {
  period: { from: string; to: string; timeZone: string };
  activeGoal: { id: string; title: string } | null;
  totals: { workoutCount: number; distanceM: number; durationS: number; paceSPerKm: number | null };
}

describe("dashboard (HTTP + PostgreSQL)", () => {
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

  it("5 km/25 min + 10 km/60 min = 340 s/km (média ponderada)", async () => {
    const { client } = await signedInClient(server);
    await createWorkoutAs(client, { performedOn: "2026-10-05", distanceM: 5000, durationS: 1500 });
    await createWorkoutAs(client, { performedOn: "2026-10-06", distanceM: 10000, durationS: 3600 });
    const res = await client.get<Dashboard>(`${D}?from=2026-10-01&to=2026-10-31`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).toEqual({
      period: { from: "2026-10-01", to: "2026-10-31", timeZone: "Europe/Lisbon" },
      activeGoal: null,
      totals: { workoutCount: 2, distanceM: 15000, durationS: 5100, paceSPerKm: 340 },
    });
  });

  it("período vazio: totais 0 e ritmo null", async () => {
    const { client } = await signedInClient(server);
    await createWorkoutAs(client, { performedOn: "2026-10-05" });
    const res = await client.get<Dashboard>(`${D}?from=2026-01-01&to=2026-01-31`);
    expect(res.body.totals).toEqual({ workoutCount: 0, distanceM: 0, durationS: 0, paceSPerKm: null });
  });

  it("limites inclusivos: conta from e to, ignora o dia antes e o dia depois", async () => {
    const { client } = await signedInClient(server);
    for (const [performedOn, distanceM] of [
      ["2026-10-01", 1000],
      ["2026-10-02", 2000],
      ["2026-10-04", 4000],
      ["2026-10-05", 8000],
    ] as const) {
      await createWorkoutAs(client, { performedOn, distanceM, durationS: 600 });
    }
    const res = await client.get<Dashboard>(`${D}?from=2026-10-02&to=2026-10-04`);
    expect(res.body.totals).toMatchObject({ workoutCount: 2, distanceM: 6000, durationS: 1200, paceSPerKm: 200 });
    const single = await client.get<Dashboard>(`${D}?from=2026-10-05&to=2026-10-05`);
    expect(single.body.totals).toMatchObject({ workoutCount: 1, distanceM: 8000 });
  });

  it("ignora os dados de B (treinos e objetivo)", async () => {
    const a = await signedInClient(server);
    const b = await signedInClient(server);
    await createWorkoutAs(a.client, { performedOn: "2026-10-07", distanceM: 3000, durationS: 900 });
    await createWorkoutAs(b.client, { performedOn: "2026-10-07", distanceM: 99000, durationS: 99000 });
    await b.client.post("/api/v1/goals", { title: "Objetivo da B", targetDistanceM: 42195 });

    const res = await a.client.get<Dashboard>(`${D}?from=2026-10-01&to=2026-10-31`);
    expect(res.body.totals).toEqual({ workoutCount: 1, distanceM: 3000, durationS: 900, paceSPerKm: 300 });
    expect(res.body.activeGoal).toBeNull();
  });

  it("inclui o objetivo ativo do utilizador", async () => {
    const { client } = await signedInClient(server);
    const goal = await client.post<{ id: string }>("/api/v1/goals", { title: "10 km", targetDistanceM: 10000 });
    const res = await client.get<Dashboard>(`${D}?from=2026-10-01&to=2026-10-31`);
    expect(res.body.activeGoal).toMatchObject({ id: goal.body.id, title: "10 km" });
  });

  it("totais recalculados após criar, editar e eliminar treinos", async () => {
    const { client } = await signedInClient(server);
    const query = `${D}?from=2026-10-01&to=2026-10-31`;
    const totals = async () => (await client.get<Dashboard>(query)).body.totals;

    const first = await createWorkoutAs(client, { performedOn: "2026-10-03", distanceM: 4000, durationS: 1200 });
    expect(await totals()).toEqual({ workoutCount: 1, distanceM: 4000, durationS: 1200, paceSPerKm: 300 });

    const second = await createWorkoutAs(client, { performedOn: "2026-10-04", distanceM: 6000, durationS: 2400 });
    expect(await totals()).toEqual({ workoutCount: 2, distanceM: 10000, durationS: 3600, paceSPerKm: 360 });

    await client.patch<WorkoutBody>(`${W}/${second.id}`, { distanceM: 8000 });
    expect(await totals()).toEqual({ workoutCount: 2, distanceM: 12000, durationS: 3600, paceSPerKm: 300 });

    // Mover um treino para fora do período também atualiza os totais.
    await client.patch(`${W}/${first.id}`, { performedOn: "2026-09-30" });
    expect(await totals()).toEqual({ workoutCount: 1, distanceM: 8000, durationS: 2400, paceSPerKm: 300 });

    await client.delete(`${W}/${second.id}`);
    expect(await totals()).toEqual({ workoutCount: 0, distanceM: 0, durationS: 0, paceSPerKm: null });
  });

  it.each([
    ["sem filtros", ""],
    ["sem to", "from=2026-10-01"],
    ["sem from", "to=2026-10-31"],
    ["from > to", "from=2026-10-31&to=2026-10-01"],
    ["data inexistente", "from=2026-02-30&to=2026-03-01"],
    ["parâmetro desconhecido", "from=2026-10-01&to=2026-10-31&userId=outro"],
  ])("query inválida (%s) → 400", async (_label, query) => {
    const { client } = await signedInClient(server);
    const res = await client.get<ProblemBody>(`${D}?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("sem sessão → 401", async () => {
    const res = await new TestClient(server.baseUrl).get<ProblemBody>(`${D}?from=2026-10-01&to=2026-10-31`);
    expect(res.status).toBe(401);
  });
});

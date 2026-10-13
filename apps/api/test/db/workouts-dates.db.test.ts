import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AUTH } from "./support/auth-harness.ts";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { signedInClient, startAuthServer, type AuthTestServer } from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import {
  createWorkoutAs,
  W,
  workoutInput,
  type ProblemBody,
  type WorkoutBody,
} from "./support/workouts-helpers.ts";

// Relógio controlado: cada teste fixa o instante "agora" da API.
let now = new Date("2026-10-12T11:00:00Z");

describe("regra de data futura no fuso do utilizador (relógio controlado)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  const originalTz = process.env["TZ"];

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => now });
  });

  afterEach(() => {
    if (originalTz === undefined) delete process.env["TZ"];
    else process.env["TZ"] = originalTz;
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("UTC+14 (Pacific/Kiritimati): 'hoje' lá é amanhã em UTC e é aceite; o dia seguinte não", async () => {
    now = new Date("2026-10-12T11:00:00Z"); // 2026-10-13 01:00 em Kiritimati
    const { client } = await signedInClient(server, { timeZone: "Pacific/Kiritimati" });

    const today = await client.post<WorkoutBody>(W, workoutInput({ performedOn: "2026-10-13" }));
    expect(today.status).toBe(201);
    expect(today.body.performedOn).toBe("2026-10-13");

    const tomorrow = await client.post<ProblemBody>(W, workoutInput({ performedOn: "2026-10-14" }));
    expect(tomorrow.status).toBe(400);
    expect(tomorrow.body.errors).toEqual([
      expect.objectContaining({ field: "performedOn", code: "date_in_future" }),
    ]);
  });

  it("Los Angeles às 23:30: o dia local é aceite e o dia seguinte (já 'hoje' em UTC) não", async () => {
    now = new Date("2026-10-13T06:30:00Z"); // 2026-10-12 23:30 em Los Angeles
    const { client } = await signedInClient(server, { timeZone: "America/Los_Angeles" });

    expect((await client.post(W, workoutInput({ performedOn: "2026-10-12" }))).status).toBe(201);
    const utcToday = await client.post<ProblemBody>(W, workoutInput({ performedOn: "2026-10-13" }));
    expect(utcToday.status).toBe(400);
    expect(utcToday.body.errors?.[0]?.code).toBe("date_in_future");
  });

  it("a meia-noite local muda o resultado com o mesmo pedido", async () => {
    const { client } = await signedInClient(server, { timeZone: "Europe/Lisbon" });
    now = new Date("2026-10-12T22:59:59Z"); // 23:59:59 em Lisboa (WEST, UTC+1)
    expect((await client.post(W, workoutInput({ performedOn: "2026-10-13" }))).status).toBe(400);
    now = new Date("2026-10-12T23:00:00Z"); // 00:00 de 13/10 em Lisboa
    expect((await client.post(W, workoutInput({ performedOn: "2026-10-13" }))).status).toBe(201);
  });

  it("PATCH para uma data futura é recusado; mudar outros campos não reavalia a data", async () => {
    now = new Date("2026-10-12T11:00:00Z");
    const { client } = await signedInClient(server, { timeZone: "Pacific/Kiritimati" });
    const workout = await createWorkoutAs(client, { performedOn: "2026-10-13" });

    const future = await client.patch<ProblemBody>(`${W}/${workout.id}`, { performedOn: "2026-10-14" });
    expect(future.status).toBe(400);
    expect(future.body.errors?.[0]?.code).toBe("date_in_future");

    // O utilizador muda para um fuso atrasado: o treino de "hoje" passa a ser "amanhã",
    // mas editar a distância continua possível (a data não muda).
    const tz = await client.post(`${AUTH}/update-user`, { timeZone: "America/Los_Angeles" });
    expect(tz.status).toBe(200);
    const distance = await client.patch<WorkoutBody>(`${W}/${workout.id}`, { distanceM: 6000 });
    expect(distance.status).toBe(200);
    expect(distance.body.performedOn).toBe("2026-10-13");
    // Reenviar a mesma data, agora no futuro para o novo fuso, é recusado.
    const sameDate = await client.patch(`${W}/${workout.id}`, { performedOn: "2026-10-13" });
    expect(sameDate.status).toBe(400);
  });

  it("performedOn mantém-se como string YYYY-MM-DD com qualquer fuso do processo", async () => {
    now = new Date("2026-10-12T11:00:00Z");
    const { client } = await signedInClient(server);
    for (const timeZone of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      process.env["TZ"] = timeZone;
      const created = await createWorkoutAs(client, { performedOn: "2026-03-29" });
      expect(created.performedOn).toBe("2026-03-29");
      const read = await client.get<WorkoutBody>(`${W}/${created.id}`);
      expect(read.body.performedOn).toBe("2026-03-29");
    }
  });
});

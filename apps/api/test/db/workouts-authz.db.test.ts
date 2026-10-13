import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  signedInClient,
  startAuthServer,
  type AuthTestServer,
  type TestClient,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import {
  collectAllIds,
  createWorkoutAs,
  MISSING_ID,
  W,
  workoutInput,
  type ProblemBody,
  type WorkoutBody,
  type WorkoutPage,
} from "./support/workouts-helpers.ts";

const NOW = new Date("2026-10-12T11:00:00Z");

interface DbRow {
  user_id: string;
  performed_on: string;
  distance_m: number;
  duration_s: number;
  notes: string | null;
  updated_at: string;
}

describe("isolamento de treinos entre utilizadores (HTTP + PostgreSQL)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  let a: { client: TestClient; userId: string };
  let b: { client: TestClient; userId: string };

  async function rowOf(id: string): Promise<DbRow | undefined> {
    const { rows } = await handle.pool.query<DbRow>(
      `select user_id, performed_on::text, distance_m, duration_s, notes, updated_at::text
         from workouts where id = $1`,
      [id],
    );
    return rows[0];
  }

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => NOW });
    a = await signedInClient(server, { name: "Utilizadora A" });
    b = await signedInClient(server, { name: "Utilizador B" });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("B não consegue ler, alterar nem eliminar o treino de A; o treino fica intacto", async () => {
    const workout = await createWorkoutAs(a.client, { notes: "só da A" });
    const before = await rowOf(workout.id);

    const missing = await b.client.get<ProblemBody>(`${W}/${MISSING_ID}`);
    const attempts = [
      await b.client.get<ProblemBody>(`${W}/${workout.id}`),
      await b.client.patch<ProblemBody>(`${W}/${workout.id}`, { distanceM: 1, notes: "da B" }),
      await b.client.delete<ProblemBody>(`${W}/${workout.id}`),
    ];
    for (const res of attempts) {
      // Exatamente a mesma resposta que um treino inexistente (exceto o requestId).
      expect(res.status).toBe(404);
      expect({ ...res.body, requestId: undefined }).toEqual({ ...missing.body, requestId: undefined });
      expect(res.text).not.toContain("só da A");
    }

    expect(await rowOf(workout.id)).toEqual(before);
    const stillThere = await a.client.get<WorkoutBody>(`${W}/${workout.id}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body).toEqual(workout);
  });

  it("PATCH de B com dados que só falhariam na validação final devolve 404 (sem revelar existência)", async () => {
    const workout = await createWorkoutAs(a.client);
    const before = await rowOf(workout.id);
    // Data futura: válida no schema, mas recusada pela regra final. Para B, o treino
    // de A tem de parecer inexistente (404), e não "data inválida" (400).
    const futureForOwner = await b.client.patch<ProblemBody>(`${W}/${workout.id}`, {
      performedOn: "2026-12-31",
    });
    const futureForMissing = await b.client.patch<ProblemBody>(`${W}/${MISSING_ID}`, {
      performedOn: "2026-12-31",
    });
    expect(futureForOwner.status).toBe(404);
    expect(futureForMissing.status).toBe(404);
    expect({ ...futureForOwner.body, requestId: undefined }).toEqual({
      ...futureForMissing.body,
      requestId: undefined,
    });
    expect(await rowOf(workout.id)).toEqual(before);
  });

  it("as listas de A e B não misturam dados", async () => {
    const aIds = [];
    const bIds = [];
    for (let i = 0; i < 3; i++) aIds.push((await createWorkoutAs(a.client, { notes: `A${String(i)}` })).id);
    for (let i = 0; i < 2; i++) bIds.push((await createWorkoutAs(b.client, { notes: `B${String(i)}` })).id);

    const listA = await collectAllIds(a.client);
    const listB = await collectAllIds(b.client);
    for (const id of aIds) expect(listA.ids).toContain(id);
    for (const id of bIds) expect(listB.ids).toContain(id);
    expect(listA.ids.filter((id) => listB.ids.includes(id))).toEqual([]);

    const { rows } = await handle.pool.query<{ user_id: string }>(
      "select distinct user_id from workouts where id = any($1::uuid[])",
      [listB.ids],
    );
    expect(rows).toEqual([{ user_id: b.userId }]);
  });

  it("userId adulterado é rejeitado sem efeito (POST, PATCH e query)", async () => {
    const count = async () =>
      (await handle.pool.query<{ n: number }>("select count(*)::int as n from workouts")).rows[0]?.n;
    const before = await count();

    const post = await a.client.post<ProblemBody>(W, workoutInput({ userId: b.userId }));
    expect(post.status).toBe(400);
    expect(post.body.errors?.[0]).toMatchObject({ field: "userId", code: "unknown_field" });
    expect(await count()).toBe(before);

    const own = await createWorkoutAs(a.client);
    const ownBefore = await rowOf(own.id);
    const patch = await a.client.patch<ProblemBody>(`${W}/${own.id}`, { userId: b.userId, distanceM: 1 });
    expect(patch.status).toBe(400);
    expect(await rowOf(own.id)).toEqual(ownBefore);

    const list = await a.client.get<ProblemBody>(`${W}?userId=${encodeURIComponent(b.userId)}`);
    expect(list.status).toBe(400);
    expect(list.body.code).toBe("VALIDATION_ERROR");
  });

  it("um cursor de A usado por B só devolve treinos de B", async () => {
    for (let i = 0; i < 4; i++) await createWorkoutAs(a.client, { performedOn: "2026-09-0" + String(i + 1) });
    const pageA = await a.client.get<WorkoutPage>(`${W}?limit=2`);
    expect(pageA.body.nextCursor).not.toBeNull();

    const withStolenCursor = await b.client.get<WorkoutPage>(
      `${W}?limit=100&cursor=${encodeURIComponent(pageA.body.nextCursor ?? "")}`,
    );
    expect(withStolenCursor.status).toBe(200);
    const ids = withStolenCursor.body.items.map((item) => item.id);
    const { rows } = await handle.pool.query<{ user_id: string }>(
      "select distinct user_id from workouts where id = any($1::uuid[])",
      [ids],
    );
    for (const row of rows) expect(row.user_id).toBe(b.userId);
  });
});

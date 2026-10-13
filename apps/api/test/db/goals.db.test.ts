import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import {
  signedInClient,
  startAuthServer,
  TestClient,
  UNTRUSTED_ORIGIN,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import { MISSING_ID, type ProblemBody } from "./support/workouts-helpers.ts";

const G = "/api/v1/goals";
// 2026-10-12 11:00 UTC = 2026-10-12 em Lisboa e 2026-10-13 em Kiritimati (UTC+14).
const NOW = new Date("2026-10-12T11:00:00Z");

interface GoalBody {
  id: string;
  title: string;
  targetDistanceM: number;
  targetDate: string | null;
  status: "active" | "completed" | "replaced";
  completedAt: string | null;
  replacedAt: string | null;
}

const goalInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Meia maratona",
  targetDistanceM: 21097,
  targetDate: "2026-12-06",
  ...overrides,
});

describe("objetivos (HTTP + PostgreSQL)", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  async function statusOf(id: string): Promise<string | undefined> {
    const { rows } = await handle.pool.query<{ status: string }>("select status from goals where id = $1", [id]);
    return rows[0]?.status;
  }

  async function create(client: TestClient, overrides: Record<string, unknown> = {}): Promise<GoalBody> {
    const res = await client.post<GoalBody>(G, goalInput(overrides));
    if (res.status !== 201) throw new Error(`Criação falhou: ${String(res.status)} ${res.text}`);
    return res.body;
  }

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => NOW });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("ciclo: sem objetivo → criar → editar → concluir → criar → substituir", async () => {
    const { client } = await signedInClient(server);
    expect((await client.get<{ goal: GoalBody | null }>(`${G}/active`)).body).toEqual({ goal: null });

    const created = await client.post<GoalBody>(G, goalInput({ title: "  10 km  ", targetDistanceM: 10000 }));
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`${G}/${created.body.id}`);
    expect(created.body).toMatchObject({ title: "10 km", status: "active", completedAt: null, replacedAt: null });
    expect((await client.get<{ goal: GoalBody }>(`${G}/active`)).body.goal.id).toBe(created.body.id);

    const patched = await client.patch<GoalBody>(`${G}/${created.body.id}`, { title: "10 km rápido", targetDate: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ title: "10 km rápido", targetDistanceM: 10000, targetDate: null });

    const completed = await client.post<GoalBody>(`${G}/${created.body.id}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: "completed", completedAt: NOW.toISOString() });
    expect((await client.get(`${G}/active`)).body).toEqual({ goal: null });

    const second = await create(client, { title: "Meia" });
    const replaced = await client.post<{ previous: GoalBody; current: GoalBody }>(
      `${G}/${second.id}/replace`,
      goalInput({ title: "Maratona", targetDistanceM: 42195, targetDate: "2027-04-25" }),
    );
    expect(replaced.status).toBe(201);
    expect(replaced.body.previous).toMatchObject({ id: second.id, status: "replaced", replacedAt: NOW.toISOString() });
    expect(replaced.body.current).toMatchObject({ title: "Maratona", status: "active" });
    expect((await client.get<{ goal: GoalBody }>(`${G}/active`)).body.goal.id).toBe(replaced.body.current.id);
  });

  it("segundo objetivo ativo → 409 ACTIVE_GOAL_EXISTS", async () => {
    const { client } = await signedInClient(server);
    await create(client);
    const res = await client.post<ProblemBody>(G, goalInput({ title: "Outro" }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_GOAL_EXISTS");
  });

  it("criação concorrente: exatamente um ativo", async () => {
    const { client, userId } = await signedInClient(server);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => client.post<ProblemBody>(G, goalInput({ title: `Paralelo ${String(i)}` }))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.code === "ACTIVE_GOAL_EXISTS")).toHaveLength(5);
    const { rows } = await handle.pool.query<{ n: number }>(
      "select count(*)::int as n from goals where user_id = $1 and status = 'active'",
      [userId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("transições inválidas: editar, concluir ou substituir um objetivo que não está ativo → 409", async () => {
    const { client } = await signedInClient(server);
    const goal = await create(client);
    await client.post(`${G}/${goal.id}/complete`);
    for (const res of [
      await client.patch<ProblemBody>(`${G}/${goal.id}`, { title: "Novo" }),
      await client.post<ProblemBody>(`${G}/${goal.id}/complete`),
      await client.post<ProblemBody>(`${G}/${goal.id}/replace`, goalInput()),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GOAL_NOT_ACTIVE");
    }
    expect(await statusOf(goal.id)).toBe("completed");
  });

  it("substituição com falha faz rollback (o anterior continua ativo)", async () => {
    const { client, userId } = await signedInClient(server);
    const goal = await create(client);
    // Falha forçada na criação do novo objetivo, depois de o anterior já ter sido marcado.
    await handle.pool.query(`
      create function test_fail_goal_insert() returns trigger language plpgsql as $$
      begin raise exception 'falha forçada no teste'; end $$;
      create trigger test_fail_goal_insert before insert on goals
        for each row when (new.title = 'FALHA-FORCADA') execute function test_fail_goal_insert();
    `);
    try {
      const res = await client.post<ProblemBody>(`${G}/${goal.id}/replace`, goalInput({ title: "FALHA-FORCADA" }));
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL");
      expect(res.text).not.toContain("falha forçada");
    } finally {
      await handle.pool.query(
        "drop trigger test_fail_goal_insert on goals; drop function test_fail_goal_insert();",
      );
    }
    expect(await statusOf(goal.id)).toBe("active");
    const { rows } = await handle.pool.query<{ n: number }>("select count(*)::int as n from goals where user_id = $1", [
      userId,
    ]);
    expect(rows[0]?.n).toBe(1);
    expect(server.logger.text()).toContain("Erro não tratado");
  });

  describe("datas (relógio fixo, fuso da conta)", () => {
    it("data-alvo anterior a hoje no fuso da conta → 400; hoje é aceite", async () => {
      const { client } = await signedInClient(server, { timeZone: "Pacific/Kiritimati" });
      const past = await client.post<ProblemBody>(G, goalInput({ targetDate: "2026-10-12" }));
      expect(past.status).toBe(400);
      expect(past.body.errors?.[0]).toMatchObject({ field: "targetDate", code: "date_in_past" });
      expect((await client.post(G, goalInput({ targetDate: "2026-10-13" }))).status).toBe(201);
    });

    it("sem data-alvo é aceite; alterar para data passada → 400", async () => {
      const { client } = await signedInClient(server);
      const goal = await create(client, { targetDate: null });
      expect(goal.targetDate).toBeNull();
      const res = await client.patch<ProblemBody>(`${G}/${goal.id}`, { targetDate: "2026-10-11" });
      expect(res.status).toBe(400);
      expect(res.body.errors?.[0]?.code).toBe("date_in_past");
    });

    it("objetivo vencido: outros campos editáveis, pode ser concluído ou substituído", async () => {
      const { client } = await signedInClient(server);
      const goal = await create(client);
      await handle.pool.query("update goals set target_date = '2026-09-01' where id = $1", [goal.id]);
      const edited = await client.patch<GoalBody>(`${G}/${goal.id}`, { title: "Ainda vale" });
      expect(edited.status).toBe(200);
      expect(edited.body.targetDate).toBe("2026-09-01");
      const replaced = await client.post(`${G}/${goal.id}/replace`, goalInput());
      expect(replaced.status).toBe(201);

      const other = await signedInClient(server);
      const overdue = await create(other.client);
      await handle.pool.query("update goals set target_date = '2026-09-01' where id = $1", [overdue.id]);
      expect((await other.client.post(`${G}/${overdue.id}/complete`)).status).toBe(200);
    });
  });

  describe("validação", () => {
    it.each([
      ["userId no corpo", goalInput({ userId: "outro" }), "userId"],
      ["status no corpo", goalInput({ status: "completed" }), "status"],
      ["título vazio", goalInput({ title: "   " }), "title"],
      ["distância decimal", goalInput({ targetDistanceM: 10.5 }), "targetDistanceM"],
      ["data inexistente", goalInput({ targetDate: "2026-02-30" }), "targetDate"],
    ])("criação rejeita %s", async (_label, body, field) => {
      const { client } = await signedInClient(server);
      const res = await client.post<ProblemBody>(G, body);
      expect(res.status).toBe(400);
      expect(res.body.errors?.map((e) => e.field)).toContain(field);
    });

    it("PATCH vazio, campo desconhecido, id inválido e corpo no complete são recusados", async () => {
      const { client } = await signedInClient(server);
      const goal = await create(client);
      expect((await client.patch(`${G}/${goal.id}`, {})).status).toBe(400);
      expect((await client.patch(`${G}/${goal.id}`, { status: "completed" })).status).toBe(400);
      expect((await client.patch<ProblemBody>(`${G}/1`, { title: "x" })).body.code).toBe("INVALID_ID");
      expect((await client.post(`${G}/${goal.id}/complete`, { force: true })).status).toBe(400);
      expect(await statusOf(goal.id)).toBe("active");
    });

    it("sem sessão → 401; origem maliciosa → 403", async () => {
      expect((await new TestClient(server.baseUrl).get(`${G}/active`)).status).toBe(401);
      const { client } = await signedInClient(server);
      const attacker = new TestClient(server.baseUrl, { origin: UNTRUSTED_ORIGIN });
      for (const [name, value] of client.cookies) attacker.cookies.set(name, value);
      expect((await attacker.post<ProblemBody>(G, goalInput())).body.code).toBe("FORBIDDEN_ORIGIN");
    });
  });

  it("isolamento A/B em todas as ações: o objetivo de A é 404 para B e fica intacto", async () => {
    const a = await signedInClient(server);
    const b = await signedInClient(server);
    const goalA = await create(a.client, { title: "Só da A" });
    const completedA = await create((await signedInClient(server)).client);

    expect((await b.client.get<{ goal: GoalBody | null }>(`${G}/active`)).body.goal).toBeNull();

    const missing = await b.client.patch<ProblemBody>(`${G}/${MISSING_ID}`, { title: "x" });
    const attempts = [
      await b.client.patch<ProblemBody>(`${G}/${goalA.id}`, { title: "da B" }),
      await b.client.patch<ProblemBody>(`${G}/${goalA.id}`, { targetDate: "2020-01-01" }),
      await b.client.post<ProblemBody>(`${G}/${goalA.id}/complete`),
      await b.client.post<ProblemBody>(`${G}/${goalA.id}/replace`, goalInput()),
      await b.client.post<ProblemBody>(`${G}/${goalA.id}/replace`, goalInput({ targetDate: "2020-01-01" })),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect({ ...res.body, requestId: undefined }).toEqual({ ...missing.body, requestId: undefined });
    }
    // Objetivo de outra pessoa já concluído: também 404 (não 409).
    await handle.pool.query("update goals set status = 'completed', completed_at = now() where id = $1", [
      completedA.id,
    ]);
    expect((await b.client.post(`${G}/${completedA.id}/complete`)).status).toBe(404);

    const { rows } = await handle.pool.query<{ title: string; status: string }>(
      "select title, status from goals where id = $1",
      [goalA.id],
    );
    expect(rows[0]).toEqual({ title: "Só da A", status: "active" });
    expect((await b.client.get<{ goal: GoalBody | null }>(`${G}/active`)).body.goal).toBeNull();
  });
});

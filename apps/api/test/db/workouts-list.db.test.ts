import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { encodeCursor } from "../../src/workouts/cursor.ts";
import { signedInClient, startAuthServer, type AuthTestServer, type TestClient } from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";
import {
  collectAllIds,
  createWorkoutAs,
  W,
  type ProblemBody,
  type WorkoutPage,
} from "./support/workouts-helpers.ts";

const NOW = new Date("2026-10-12T11:00:00Z");
const DATES = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
const TOTAL = 47;

describe("histórico: ordenação, filtros e paginação por cursor", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;
  let client: TestClient;
  let userId: string;

  /** Ordem esperada calculada diretamente na base, de forma independente da API. */
  async function expectedIds(from?: string, to?: string): Promise<string[]> {
    const { rows } = await handle.pool.query<{ id: string }>(
      `select id from workouts
        where user_id = $1 and ($2::date is null or performed_on >= $2) and ($3::date is null or performed_on <= $3)
        order by performed_on desc, created_at desc, id desc`,
      [userId, from ?? null, to ?? null],
    );
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    server = await startAuthServer(handle, { clock: () => NOW });
    ({ client, userId } = await signedInClient(server));
    // 47 treinos em 5 dias (muitos empates de data).
    for (let i = 0; i < TOTAL; i++) {
      await createWorkoutAs(client, { performedOn: DATES[i % DATES.length], notes: `#${String(i)}` });
    }
    // Empates também em created_at: 12 treinos com o mesmo instante (desempate por id).
    await handle.pool.query(
      `update workouts set created_at = timestamptz '2026-10-03 08:00:00.123456+00'
        where id in (select id from workouts where user_id = $1 order by id limit 12)`,
      [userId],
    );
    // Outro utilizador, para garantir que não aparece.
    const other = await signedInClient(server);
    await createWorkoutAs(other.client, { performedOn: "2026-10-03" });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it("ordem: performed_on DESC, created_at DESC, id DESC (com empates)", async () => {
    const res = await client.get<WorkoutPage>(`${W}?limit=100`);
    expect(res.body.items.map((item) => item.id)).toEqual(await expectedIds());
    const dates = res.body.items.map((item) => item.performedOn);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it.each([1, 7, 10, 20, 46, 47, 100])(
    "limit=%d: percorre todas as páginas sem duplicações nem omissões",
    async (limit) => {
      const { ids, pages } = await collectAllIds(client, { limit: String(limit) });
      expect(ids).toEqual(await expectedIds());
      expect(new Set(ids).size).toBe(TOTAL);
      expect(pages).toBe(Math.max(1, Math.ceil(TOTAL / limit)));
    },
  );

  it("limite por omissão: 20", async () => {
    const res = await client.get<WorkoutPage>(W);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it("filtros from/to inclusivos, também com paginação", async () => {
    const single = await client.get<WorkoutPage>(`${W}?from=2026-10-03&to=2026-10-03&limit=100`);
    expect(single.body.items.every((item) => item.performedOn === "2026-10-03")).toBe(true);
    expect(single.body.items.map((item) => item.id)).toEqual(await expectedIds("2026-10-03", "2026-10-03"));

    const range = await collectAllIds(client, { from: "2026-10-02", to: "2026-10-04", limit: "4" });
    expect(range.ids).toEqual(await expectedIds("2026-10-02", "2026-10-04"));

    const onlyFrom = await collectAllIds(client, { from: "2026-10-05", limit: "3" });
    expect(onlyFrom.ids).toEqual(await expectedIds("2026-10-05"));
    const onlyTo = await collectAllIds(client, { to: "2026-10-01", limit: "3" });
    expect(onlyTo.ids).toEqual(await expectedIds(undefined, "2026-10-01"));
  });

  it("período sem treinos: lista vazia e sem cursor", async () => {
    const res = await client.get<WorkoutPage>(`${W}?from=2020-01-01&to=2020-01-31`);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ["from > to", "from=2026-10-05&to=2026-10-01"],
    ["data inexistente", "from=2026-02-30"],
    ["data com formato errado", "to=12-10-2026"],
    ["limit 0", "limit=0"],
    ["limit 101", "limit=101"],
    ["limit negativo", "limit=-1"],
    ["limit decimal", "limit=1.5"],
    ["limit não numérico", "limit=abc"],
    ["limit repetido", "limit=10&limit=20"],
    ["parâmetro desconhecido", "sort=asc"],
    ["userId na query", "userId=outro"],
  ])("query inválida (%s): 400", async (_label, query) => {
    const res = await client.get<ProblemBody>(`${W}?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  describe("cursor", () => {
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const valid = {
      v: 1,
      p: "2026-10-03",
      c: "2026-10-03T08:00:00.123456Z",
      i: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
      f: null,
      t: null,
    };

    it.each([
      ["texto arbitrário", "isto-nao-e-cursor!"],
      ["base64 sem JSON", Buffer.from("olá").toString("base64url")],
      ["versão desconhecida", b64({ ...valid, v: 2 })],
      ["campo extra", b64({ ...valid, u: "outro-utilizador" })],
      ["data inválida", b64({ ...valid, p: "2026-02-30" })],
      ["instante sem microssegundos", b64({ ...valid, c: "2026-10-03T08:00:00Z" })],
      ["id inválido", b64({ ...valid, i: "1" })],
      ["tipos errados", b64({ ...valid, p: 20261003 })],
      ["demasiado longo", "a".repeat(600)],
      ["vazio", ""],
    ])("cursor inválido (%s): 400 INVALID_CURSOR", async (_label, cursor) => {
      const res = await client.get<ProblemBody>(`${W}?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });

    it("cursor de outros filtros é recusado; mudar só o limit é permitido", async () => {
      const first = await client.get<WorkoutPage>(`${W}?from=2026-10-02&limit=5`);
      const cursor = encodeURIComponent(first.body.nextCursor ?? "");
      const otherFilters = await client.get<ProblemBody>(`${W}?from=2026-10-03&limit=5&cursor=${cursor}`);
      expect(otherFilters.status).toBe(400);
      expect(otherFilters.body.code).toBe("INVALID_CURSOR");
      const noFilters = await client.get<ProblemBody>(`${W}?limit=5&cursor=${cursor}`);
      expect(noFilters.status).toBe(400);
      const otherLimit = await client.get<WorkoutPage>(`${W}?from=2026-10-02&limit=50&cursor=${cursor}`);
      expect(otherLimit.status).toBe(200);
    });

    it("um cursor bem formado mas forjado só posiciona a leitura nos dados do próprio utilizador", async () => {
      const forged = encodeCursor(
        { performedOn: "2099-12-31", createdAt: "2099-12-31T00:00:00.000000Z", id: valid.i },
        { from: null, to: null },
      );
      const res = await client.get<WorkoutPage>(`${W}?limit=100&cursor=${forged}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((item) => item.id)).toEqual(await expectedIds());
    });
  });
});

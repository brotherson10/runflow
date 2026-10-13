import { describe, expect, it } from "vitest";
import { ProblemError } from "../src/problem.ts";
import { decodeCursor, encodeCursor } from "../src/workouts/cursor.ts";

const position = {
  performedOn: "2026-10-03",
  createdAt: "2026-10-03T08:00:00.123456Z",
  id: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
};

describe("cursor de paginação", () => {
  it("ida e volta com os mesmos filtros", () => {
    const filters = { from: "2026-10-01", to: null };
    const cursor = encodeCursor(position, filters);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, filters)).toEqual(position);
  });

  it("não contém o utilizador nem dados do treino além da posição", () => {
    const decoded = JSON.parse(
      Buffer.from(encodeCursor(position, { from: null, to: null }), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["c", "f", "i", "p", "t", "v"]);
  });

  it.each([
    [{ from: "2026-10-02", to: null }],
    [{ from: null, to: null }],
    [{ from: "2026-10-01", to: "2026-10-31" }],
  ])("recusa filtros diferentes (%j)", (other) => {
    const cursor = encodeCursor(position, { from: "2026-10-01", to: null });
    expect(() => decodeCursor(cursor, other)).toThrow(ProblemError);
  });

  it("erros são 400 INVALID_CURSOR", () => {
    try {
      decodeCursor("%%%", { from: null, to: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      expect(error).toMatchObject({ status: 400, code: "INVALID_CURSOR" });
    }
  });
});

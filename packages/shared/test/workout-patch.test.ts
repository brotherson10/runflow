import { describe, expect, it } from "vitest";
import { LIMITS, resourceIdSchema, workoutPatchSchema } from "../src/schemas.ts";

describe("workoutPatchSchema", () => {
  it("aceita alterações parciais e mantém ausentes os campos não enviados", () => {
    expect(workoutPatchSchema.parse({ distanceM: 8000 })).toEqual({ distanceM: 8000 });
    expect(workoutPatchSchema.parse({ performedOn: "2026-10-01", durationS: 1800 })).toEqual({
      performedOn: "2026-10-01",
      durationS: 1800,
    });
  });

  it.each([
    [null, null],
    ["", null],
    ["   ", null],
    ["  Nota nova  ", "Nota nova"],
  ])("notes %j fica %j", (notes, expected) => {
    expect(workoutPatchSchema.parse({ notes })).toEqual({ notes: expected });
  });

  it("rejeita PATCH vazio", () => {
    expect(workoutPatchSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    ["userId", { userId: "outro" }],
    ["id", { id: "00000000-0000-4000-8000-000000000000" }],
    ["createdAt", { createdAt: "2020-01-01T00:00:00Z" }],
    ["distância decimal", { distanceM: 10.5 }],
    ["distância em texto", { distanceM: "1000" }],
    ["duração 0", { durationS: 0 }],
    ["data inexistente", { performedOn: "2026-02-30" }],
    ["notas longas", { notes: "x".repeat(LIMITS.notesMaxLength + 1) }],
    ["notas número", { notes: 5 }],
  ])("rejeita %s", (_label, body) => {
    expect(workoutPatchSchema.safeParse(body).success).toBe(false);
  });
});

describe("resourceIdSchema", () => {
  it("aceita UUID canónico em minúsculas", () => {
    expect(resourceIdSchema.safeParse("3f2b8a1c-9d4e-4c7a-8b1f-0a2b3c4d5e6f").success).toBe(true);
  });

  it.each([
    "3F2B8A1C-9D4E-4C7A-8B1F-0A2B3C4D5E6F",
    "3f2b8a1c9d4e4c7a8b1f0a2b3c4d5e6f",
    "{3f2b8a1c-9d4e-4c7a-8b1f-0a2b3c4d5e6f}",
    " 3f2b8a1c-9d4e-4c7a-8b1f-0a2b3c4d5e6f",
    "1",
    "1.0",
    "abc",
    "",
    "00000000-0000-0000-0000-000000000000",
  ])("rejeita %j", (value) => {
    expect(resourceIdSchema.safeParse(value).success).toBe(false);
  });
});

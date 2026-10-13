import { describe, expect, it } from "vitest";
import {
  LIMITS,
  distanceMSchema,
  durationSSchema,
  goalInputSchema,
  goalTitleSchema,
  notesSchema,
  workoutInputSchema,
} from "../src/schemas.ts";

const validWorkout = {
  performedOn: "2026-10-12",
  distanceM: 5000,
  durationS: 1500,
};

describe("distanceMSchema", () => {
  it.each([1, 5000, LIMITS.distanceM.max])("aceita %d metros", (value) => {
    expect(distanceMSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    0,
    -1,
    5000.5,
    LIMITS.distanceM.max + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "5000",
    true,
    null,
    undefined,
    {},
    [5000],
  ])("rejeita %j", (value) => {
    expect(distanceMSchema.safeParse(value).success).toBe(false);
  });
});

describe("durationSSchema", () => {
  it.each([1, 1500, LIMITS.durationS.max])("aceita %d segundos", (value) => {
    expect(durationSSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, -60, 90.5, LIMITS.durationS.max + 1, "1500", false, null, [1500]])(
    "rejeita %j",
    (value) => {
      expect(durationSSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("goalTitleSchema", () => {
  it("faz trim", () => {
    expect(goalTitleSchema.parse("  Meia maratona  ")).toBe("Meia maratona");
  });

  it.each(["", "   ", "\t\n "])("rejeita só espaços %j", (value) => {
    expect(goalTitleSchema.safeParse(value).success).toBe(false);
  });

  it("aplica o limite em caracteres Unicode, não em unidades UTF-16", () => {
    const emoji80 = "🏃".repeat(LIMITS.goalTitleLength.max);
    expect(goalTitleSchema.safeParse(emoji80).success).toBe(true);
    expect(goalTitleSchema.safeParse(`${emoji80}x`).success).toBe(false);
  });

  it("aceita o máximo depois do trim", () => {
    const max = "a".repeat(LIMITS.goalTitleLength.max);
    expect(goalTitleSchema.safeParse(`  ${max}  `).success).toBe(true);
    expect(goalTitleSchema.safeParse(`${max}a`).success).toBe(false);
  });

  it.each([123, null, undefined, ["título"], { title: "x" }])("rejeita tipo %j", (value) => {
    expect(goalTitleSchema.safeParse(value).success).toBe(false);
  });
});

describe("notesSchema", () => {
  it.each([
    [undefined, null],
    [null, null],
    ["", null],
    ["   ", null],
    ["  Treino leve  ", "Treino leve"],
  ])("normaliza %j para %j", (input, expected) => {
    expect(notesSchema.parse(input)).toBe(expected);
  });

  it("aceita até 1000 caracteres e rejeita 1001", () => {
    expect(notesSchema.safeParse("x".repeat(1000)).success).toBe(true);
    expect(notesSchema.safeParse("x".repeat(1001)).success).toBe(false);
  });

  it.each([42, true, ["nota"], { text: "nota" }])("rejeita tipo %j", (value) => {
    expect(notesSchema.safeParse(value).success).toBe(false);
  });
});

describe("workoutInputSchema", () => {
  it("aceita um treino válido e normaliza notas ausentes para null", () => {
    expect(workoutInputSchema.parse(validWorkout)).toEqual({ ...validWorkout, notes: null });
  });

  it("guarda payloads HTML como texto literal (escape é na saída)", () => {
    const notes = '<img src=x onerror="alert(1)">';
    expect(workoutInputSchema.parse({ ...validWorkout, notes }).notes).toBe(notes);
  });

  it.each([
    ["data inexistente", { performedOn: "2026-02-30" }],
    ["data com hora", { performedOn: "2026-10-12T10:00:00Z" }],
    ["data antes de 1970", { performedOn: "1969-12-31" }],
    ["data como número", { performedOn: 20261012 }],
    ["distância em string", { distanceM: "5000" }],
    ["distância decimal", { distanceM: 5000.5 }],
    ["distância zero", { distanceM: 0 }],
    ["duração negativa", { durationS: -1 }],
    ["duração boolean", { durationS: true }],
    ["notas longas", { notes: "x".repeat(1001) }],
    ["campo desconhecido", { userId: "outro" }],
  ])("rejeita %s", (_label, override) => {
    expect(workoutInputSchema.safeParse({ ...validWorkout, ...override }).success).toBe(false);
  });

  it.each([null, [], "texto", 5])("rejeita body %j", (value) => {
    expect(workoutInputSchema.safeParse(value).success).toBe(false);
  });

  it("indica o campo inválido", () => {
    const result = workoutInputSchema.safeParse({ ...validWorkout, distanceM: -5 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["distanceM"]);
  });
});

describe("goalInputSchema", () => {
  it("aceita objetivo sem data e normaliza para null", () => {
    expect(goalInputSchema.parse({ title: " 10 km ", targetDistanceM: 10000 })).toEqual({
      title: "10 km",
      targetDistanceM: 10000,
      targetDate: null,
    });
  });

  it("aceita data-alvo válida", () => {
    expect(
      goalInputSchema.parse({ title: "Maratona", targetDistanceM: 42195, targetDate: "2027-04-25" })
        .targetDate,
    ).toBe("2027-04-25");
  });

  it.each([
    ["título vazio", { title: "   " }],
    ["distância decimal", { targetDistanceM: 42195.5 }],
    ["distância negativa", { targetDistanceM: -1 }],
    ["data inexistente", { targetDate: "2027-02-29" }],
    ["campo desconhecido", { progress: 50 }],
  ])("rejeita %s", (_label, override) => {
    const base = { title: "Maratona", targetDistanceM: 42195 };
    expect(goalInputSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

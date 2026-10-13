import { describe, expect, it } from "vitest";
import { averagePaceSecondsPerKm, summarizeWorkouts } from "../src/pace.ts";

describe("averagePaceSecondsPerKm", () => {
  it("usa a média ponderada: 5 km/25 min + 10 km/60 min = 340 s/km", () => {
    expect(averagePaceSecondsPerKm(25 * 60 + 60 * 60, 5000 + 10000)).toBe(340);
  });

  it("devolve null sem distância", () => {
    expect(averagePaceSecondsPerKm(0, 0)).toBeNull();
    expect(averagePaceSecondsPerKm(600, 0)).toBeNull();
  });

  it("arredonda ao segundo", () => {
    expect(averagePaceSecondsPerKm(1000, 3000)).toBe(333);
    expect(averagePaceSecondsPerKm(1001, 2000)).toBe(501);
  });

  it.each([
    [-1, 1000],
    [100, -1],
    [100.5, 1000],
    [Number.NaN, 1000],
  ])("rejeita totais inválidos (%d, %d)", (duration, distance) => {
    expect(() => averagePaceSecondsPerKm(duration, distance)).toThrow(RangeError);
  });
});

describe("summarizeWorkouts", () => {
  it("não calcula a média dos ritmos individuais", () => {
    const totals = summarizeWorkouts([
      { distanceM: 5000, durationS: 1500 },
      { distanceM: 10000, durationS: 3600 },
    ]);
    expect(totals).toEqual({
      workoutCount: 2,
      totalDistanceM: 15000,
      totalDurationS: 5100,
      averagePaceSPerKm: 340,
    });
    // A média simples dos ritmos (300 e 360) seria 330, valor incorreto.
    expect(totals.averagePaceSPerKm).not.toBe(330);
  });

  it("período vazio: totais zero e ritmo null", () => {
    expect(summarizeWorkouts([])).toEqual({
      workoutCount: 0,
      totalDistanceM: 0,
      totalDurationS: 0,
      averagePaceSPerKm: null,
    });
  });
});

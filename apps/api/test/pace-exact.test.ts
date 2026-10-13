import { averagePaceSecondsPerKm } from "@runflow/shared";
import { describe, expect, it } from "vitest";
import { exactPaceSPerKm } from "../src/dashboard/routes.ts";

describe("exactPaceSPerKm (BigInt) vs averagePaceSecondsPerKm", () => {
  it("5 km/25 min + 10 km/60 min = 340; sem distância → null", () => {
    expect(exactPaceSPerKm(5100n, 15000n)).toBe(340);
    expect(exactPaceSPerKm(0n, 0n)).toBeNull();
  });

  it("arredonda meio para cima, como a função partilhada", () => {
    for (const [duration, distance] of [
      [1000, 3000],
      [1001, 2000],
      [1, 2000],
      [3599, 10001],
      [172800, 1],
    ] as const) {
      expect(exactPaceSPerKm(BigInt(duration), BigInt(distance))).toBe(
        averagePaceSecondsPerKm(duration, distance),
      );
    }
  });

  it("totais em que durationS * 1000 excede 2^53 continuam exatos", () => {
    // Em Number, 9_007_199_254_740_993 * 1000 já perderia precisão; em BigInt não.
    expect(exactPaceSPerKm(9_007_199_254_740_993n, 9_007_199_254_740_993_000n)).toBe(1);
    expect(exactPaceSPerKm(9_007_199_254_740_993n, 9_007_199_254_740_993n)).toBe(1000);
  });

  it("o ritmo nunca excede o maior ritmo individual possível (inteiro seguro)", () => {
    // Pior caso do domínio: 48 h em 1 m → 172 800 000 s/km, bem abaixo de 2^53.
    expect(exactPaceSPerKm(172_800n, 1n)).toBe(172_800_000);
    expect(Number.isSafeInteger(172_800_000)).toBe(true);
  });
});

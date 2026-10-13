export interface WorkoutTotalsInput {
  readonly distanceM: number;
  readonly durationS: number;
}

export interface WorkoutTotals {
  readonly workoutCount: number;
  readonly totalDistanceM: number;
  readonly totalDurationS: number;
  readonly averagePaceSPerKm: number | null;
}

function assertNonNegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} tem de ser um inteiro não negativo: ${String(value)}`);
  }
}

/**
 * Ritmo médio ponderado em segundos por km:
 * `round(totalDurationS * 1000 / totalDistanceM)`. Sem distância devolve `null`.
 * Não é a média dos ritmos de cada treino.
 */
export function averagePaceSecondsPerKm(
  totalDurationS: number,
  totalDistanceM: number,
): number | null {
  assertNonNegativeSafeInteger("totalDurationS", totalDurationS);
  assertNonNegativeSafeInteger("totalDistanceM", totalDistanceM);
  if (totalDistanceM === 0) {
    return null;
  }
  return Math.round((totalDurationS * 1000) / totalDistanceM);
}

/** Totais de um período a partir dos treinos desse período. */
export function summarizeWorkouts(workouts: readonly WorkoutTotalsInput[]): WorkoutTotals {
  let totalDistanceM = 0;
  let totalDurationS = 0;
  for (const workout of workouts) {
    assertNonNegativeSafeInteger("distanceM", workout.distanceM);
    assertNonNegativeSafeInteger("durationS", workout.durationS);
    totalDistanceM += workout.distanceM;
    totalDurationS += workout.durationS;
  }
  return {
    workoutCount: workouts.length,
    totalDistanceM,
    totalDurationS,
    averagePaceSPerKm: averagePaceSecondsPerKm(totalDurationS, totalDistanceM),
  };
}

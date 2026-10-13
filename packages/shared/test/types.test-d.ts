// Verificação estática (via `tsc` no typecheck): os campos opcionais podem ser
// omitidos na entrada e chegam sempre como `string | null` na saída.
import type { Goal, GoalInput, Workout, WorkoutInput } from "../src/schemas.ts";

export const workoutWithoutNotes: WorkoutInput = {
  performedOn: "2026-10-12",
  distanceM: 5000,
  durationS: 1500,
};

export const goalWithoutDate: GoalInput = { title: "10 km", targetDistanceM: 10000 };

export const workoutNotes: Workout["notes"] extends string | null ? true : never = true;
export const goalDate: Goal["targetDate"] extends string | null ? true : never = true;

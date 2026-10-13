/**
 * Dados FICTÍCIOS da demo. Ficam só no bundle da web: a demo não usa a API, a
 * sessão nem a cache de dados dos utilizadores reais. IDs com prefixo `demo-`.
 * Conjunto fixo (setembro–outubro de 2026); o "hoje" da demo é DEMO_TODAY.
 */
import type { Goal, Workout } from "../lib/api.ts";

export const DEMO_TODAY = "2026-10-10";
export const DEMO_USER = { name: "Corredora Demo", timeZone: "Europe/Lisbon" } as const;

function workout(id: number, performedOn: string, distanceM: number, durationS: number, notes: string | null): Workout {
  const stamp = `${performedOn}T07:30:00.000Z`;
  return { id: `demo-${String(id)}`, performedOn, distanceM, durationS, notes, createdAt: stamp, updatedAt: stamp };
}

export const DEMO_WORKOUTS: readonly Workout[] = [
  workout(14, "2026-10-09", 6000, 1950, "Rodagem leve à beira-rio."),
  workout(13, "2026-10-07", 10000, 3060, "Treino de ritmo: 3 × 2 km."),
  workout(12, "2026-10-05", 16000, 5520, "Longo de domingo, terreno plano."),
  workout(11, "2026-10-03", 5000, 1560, null),
  workout(10, "2026-10-01", 8000, 2640, "Fartlek no parque."),
  workout(9, "2026-09-28", 14000, 4900, "Longo com subidas no fim."),
  workout(8, "2026-09-26", 6000, 1980, null),
  workout(7, "2026-09-24", 9000, 2790, "Intervalos 6 × 800 m."),
  workout(6, "2026-09-21", 12000, 4200, "Longo tranquilo."),
  workout(5, "2026-09-19", 5000, 1590, null),
  workout(4, "2026-09-17", 7000, 2310, "Recuperação ativa."),
  workout(3, "2026-09-14", 10000, 3480, "Primeiro 10 km do bloco."),
];

export const DEMO_GOAL: Goal = {
  id: "demo-goal",
  title: "Meia maratona da cidade",
  targetDistanceM: 21097,
  targetDate: "2027-03-21",
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  completedAt: null,
  replacedAt: null,
};

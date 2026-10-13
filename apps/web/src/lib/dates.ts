/** Aritmética de datas civis (YYYY-MM-DD) em UTC puro, sem deslocar o dia. */
import { parseCivilDate } from "@runflow/shared";

function toCivil(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(civil: string, days: number): string {
  const parts = parseCivilDate(civil);
  if (!parts) throw new RangeError(`Data civil inválida: ${civil}`);
  return toCivil(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)));
}

export type PeriodPreset = "7d" | "30d" | "month" | "year";

export interface Period {
  readonly from: string;
  readonly to: string;
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  year: "Este ano",
};

/** Período de um preset, terminando em `today` (data civil no fuso da conta). */
export function presetPeriod(preset: PeriodPreset, today: string): Period {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

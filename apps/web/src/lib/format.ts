/**
 * Formatação e leitura de valores em PT-PT. Datas civis (YYYY-MM-DD) nunca passam
 * por `new Date("YYYY-MM-DD")`: são formatadas a partir de `Date.UTC` em UTC.
 */
import { parseCivilDate } from "@runflow/shared";

const kmFormat = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
// Abreviaturas fixas (não dependem dos dados ICU do browser).
const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

export function formatDistance(meters: number): string {
  return `${kmFormat.format(meters / 1000)} km`;
}

/** Duração legível: "45 min", "1 h 05 min", "1 h 05 min 30 s", "40 s". */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${String(hours)} h`);
  if (hours > 0 || minutes > 0) parts.push(`${hours > 0 ? String(minutes).padStart(2, "0") : String(minutes)} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${String(seconds)} s`);
  return parts.join(" ");
}

/** Ritmo em "m:ss /km" (ou "—" sem distância). */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null) return "—";
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")} /km`;
}

/** "12 out. 2026" — calculado a partir das partes da data, sem fuso horário. */
export function formatCivilDate(value: string): string {
  const parts = parseCivilDate(value);
  return parts ? `${String(parts.day)} ${MONTHS[parts.month - 1] ?? ""} ${String(parts.year)}` : value;
}

/** Dia da semana ("seg.") de uma data civil, calculado em UTC (sem deslocar o dia). */
export function formatWeekday(value: string): string {
  const parts = parseCivilDate(value);
  if (!parts) return "";
  return WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] ?? "";
}

/**
 * Lê uma distância em km escrita pelo utilizador ("10", "10,5", "10.25") e devolve
 * metros inteiros, ou `null` se for inválida (vazia, negativa, mais de 3 casas).
 */
export function parseKilometers(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(normalized)) return null;
  const meters = Math.round(Number(normalized) * 1000);
  return meters > 0 ? meters : null;
}

/** Metros → texto editável em km ("10,5"). */
export function metersToKmInput(meters: number): string {
  return String(meters / 1000).replace(".", ",");
}

/** Horas/minutos/segundos (texto) → segundos inteiros, ou `null` se inválido. */
export function parseDuration(hours: string, minutes: string, seconds: string): number | null {
  const values = [hours, minutes, seconds].map((value) => value.trim());
  if (values.some((value) => value !== "" && !/^\d{1,3}$/.test(value))) return null;
  const [h, m, s] = values.map((value) => (value === "" ? 0 : Number(value))) as [number, number, number];
  if (m > 59 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

export function splitDuration(totalSeconds: number): { hours: string; minutes: string; seconds: string } {
  return {
    hours: String(Math.floor(totalSeconds / 3600)),
    minutes: String(Math.floor((totalSeconds % 3600) / 60)),
    seconds: String(totalSeconds % 60),
  };
}

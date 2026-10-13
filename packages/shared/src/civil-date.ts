/**
 * Datas civis (calendário, sem hora nem fuso) no formato `YYYY-MM-DD`.
 *
 * Nunca convertemos estas strings com `new Date("YYYY-MM-DD")`: esse construtor
 * interpreta-as como meia-noite UTC e pode deslocar o dia num fuso negativo.
 */

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CivilDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Devolve as partes da data, ou `null` se o formato ou o calendário forem inválidos. */
export function parseCivilDate(value: string): CivilDateParts | null {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function isValidCivilDate(value: string): boolean {
  return parseCivilDate(value) !== null;
}

/** Comparação de datas civis válidas; o formato fixo permite comparar as strings. */
export function compareCivilDates(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

let ianaTimeZones: ReadonlySet<string> | undefined;

/**
 * Identificador IANA canónico conhecido pelo runtime (lista do `Intl`, mais "UTC").
 * Mais estrito do que `isValidTimeZone`: rejeita desvios ("+01:00"), variações de
 * maiúsculas e nomes não canónicos.
 */
export function isIanaTimeZone(timeZone: string): boolean {
  ianaTimeZones ??= new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);
  return ianaTimeZones.has(timeZone);
}

/** Data civil de "hoje" no fuso IANA indicado, para o instante `now`. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Fuso horário inválido: ${timeZone}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

/**
 * Regra de "data futura", separada dos schemas porque depende do fuso do
 * utilizador e do instante atual. `date` tem de ser uma data civil válida.
 */
export function isCivilDateInFuture(
  date: string,
  options: { readonly timeZone: string; readonly now?: Date },
): boolean {
  if (!isValidCivilDate(date)) {
    throw new RangeError(`Data civil inválida: ${date}`);
  }
  return compareCivilDates(date, todayInTimeZone(options.timeZone, options.now)) > 0;
}

import { z } from "zod";
import { compareCivilDates, isIanaTimeZone, isValidCivilDate } from "./civil-date.ts";

/**
 * Limites de domínio. Os máximos de distância e duração são provisórios
 * (decisão D11 em docs/decisions.md).
 */
export const LIMITS = {
  distanceM: { min: 1, max: 1_000_000 },
  durationS: { min: 1, max: 172_800 },
  goalTitleLength: { min: 1, max: 80 },
  notesMaxLength: 1000,
  minWorkoutDate: "1970-01-01",
  userNameLength: { min: 1, max: 60 },
  /** Política de palavra-passe provisória (padrão do Better Auth; ver decisions.md). */
  // NIST SP 800-63B-4 (palavra-passe como fator único): mínimo 15; sem regras de composição.
  passwordLength: { min: 15, max: 128 },
  timeZoneMaxLength: 64,
} as const;

/**
 * Comprimento em code points Unicode, a mesma unidade do `char_length` do
 * PostgreSQL (onde as constraints repetem estes limites). Não é o número de
 * grafemas visíveis: "é" decomposto (e + U+0301), bandeiras e emojis com ZWJ
 * contam vários code points nos dois lados, de forma consistente. Não há
 * normalização Unicode (NFC) nesta fase.
 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

const charLength = codePointLength;

/** Caracteres de controlo (quebras de linha, tabs, NUL...) não são aceites em nomes. */
const CONTROL_CHARACTER = /\p{Cc}/u;

export const distanceMSchema = z
  .int({ error: "Indique um número inteiro de metros." })
  .min(LIMITS.distanceM.min, { error: "A distância tem de ser positiva." })
  .max(LIMITS.distanceM.max, { error: "A distância excede o máximo permitido." });

export const durationSSchema = z
  .int({ error: "Indique um número inteiro de segundos." })
  .min(LIMITS.durationS.min, { error: "A duração tem de ser positiva." })
  .max(LIMITS.durationS.max, { error: "A duração excede o máximo permitido." });

export const civilDateSchema = z
  .string({ error: "Indique uma data no formato AAAA-MM-DD." })
  .refine(isValidCivilDate, { error: "Data inexistente ou fora do formato AAAA-MM-DD." });

export const workoutDateSchema = civilDateSchema.refine(
  (value) => compareCivilDates(value, LIMITS.minWorkoutDate) >= 0,
  { error: `A data não pode ser anterior a ${LIMITS.minWorkoutDate}.` },
);

export const goalTitleSchema = z
  .string({ error: "Indique um título." })
  .trim()
  .refine((value) => charLength(value) >= LIMITS.goalTitleLength.min, {
    error: "O título não pode ficar vazio.",
  })
  .refine((value) => charLength(value) <= LIMITS.goalTitleLength.max, {
    error: `O título tem no máximo ${LIMITS.goalTitleLength.max} caracteres.`,
  });

const notesTextSchema = z
  .string({ error: "As observações têm de ser texto." })
  .trim()
  .refine((value) => charLength(value) <= LIMITS.notesMaxLength, {
    error: `As observações têm no máximo ${LIMITS.notesMaxLength} caracteres.`,
  });

/** Observações opcionais: trim; vazio ou ausente passa a `null`. */
export const notesSchema = notesTextSchema
  .nullish()
  .transform((value) => (value === undefined || value === null || value === "" ? null : value));

/**
 * Dados de um treino enviados pelo cliente. Campos desconhecidos (ex.: `userId`)
 * são rejeitados. A regra "sem datas futuras" fica em `isCivilDateInFuture`.
 */
export const workoutInputSchema = z.strictObject({
  performedOn: workoutDateSchema,
  distanceM: distanceMSchema,
  durationS: durationSSchema,
  // Sem `.optional()` exterior: com ele, uma chave ausente salta o transform
  // e `notes` não seria normalizado para `null`. `nullish()` já aceita ausência.
  notes: notesSchema,
});

/**
 * Alteração parcial de um treino (PATCH). Só os campos enviados mudam; `notes: null`
 * (ou texto vazio) limpa as observações. Tem de trazer pelo menos um campo. O
 * resultado final (treino atual + alterações) é validado com `workoutInputSchema`.
 */
export const workoutPatchSchema = z
  .strictObject({
    performedOn: workoutDateSchema.optional(),
    distanceM: distanceMSchema.optional(),
    durationS: durationSSchema.optional(),
    notes: notesTextSchema
      .nullable()
      .transform((value) => (value === null || value === "" ? null : value))
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: "Indique pelo menos um campo a alterar.",
  });

/** UUID canónico em minúsculas, sem coerção (ex.: "1.0" ou maiúsculas não são aceites). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const resourceIdSchema = z
  .string({ error: "Identificador inválido." })
  .regex(UUID_PATTERN, { error: "Identificador inválido." });

/** Objetivo: distância de uma corrida, com data-alvo opcional (sem progresso automático). */
export const goalInputSchema = z.strictObject({
  title: goalTitleSchema,
  targetDistanceM: distanceMSchema,
  targetDate: civilDateSchema.nullish().transform((value) => value ?? null),
});

/**
 * Alteração parcial de um objetivo (PATCH). Pelo menos um campo; `targetDate: null`
 * remove a data-alvo. O resultado final é validado com `goalInputSchema`.
 */
export const goalPatchSchema = z
  .strictObject({
    title: goalTitleSchema.optional(),
    targetDistanceM: distanceMSchema.optional(),
    targetDate: civilDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: "Indique pelo menos um campo a alterar.",
  });

/** Nome apresentado do utilizador: trim, 1–60 caracteres, sem caracteres de controlo. */
export const userNameSchema = z
  .string({ error: "Indique um nome." })
  .trim()
  .refine((value) => charLength(value) >= LIMITS.userNameLength.min, {
    error: "O nome não pode ficar vazio.",
  })
  .refine((value) => charLength(value) <= LIMITS.userNameLength.max, {
    error: `O nome tem no máximo ${LIMITS.userNameLength.max} caracteres.`,
  })
  .refine((value) => !CONTROL_CHARACTER.test(value), {
    error: "O nome contém caracteres inválidos.",
  });

/** Fuso horário IANA canónico (ex.: "Europe/Lisbon"). Desvios como "+01:00" não são aceites. */
export const timeZoneSchema = z
  .string({ error: "Indique um fuso horário." })
  .max(LIMITS.timeZoneMaxLength, { error: "Fuso horário inválido." })
  .refine(isIanaTimeZone, { error: "Fuso horário IANA inválido (ex.: Europe/Lisbon)." });

export type WorkoutInput = z.input<typeof workoutInputSchema>;
export type WorkoutPatch = z.output<typeof workoutPatchSchema>;
export type Workout = z.output<typeof workoutInputSchema>;
export type GoalInput = z.input<typeof goalInputSchema>;
export type GoalPatch = z.output<typeof goalPatchSchema>;
export type Goal = z.output<typeof goalInputSchema>;

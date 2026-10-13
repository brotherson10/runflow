import type { z } from "zod";
import { ProblemError, type FieldError } from "../problem.ts";

const MAX_FIELD_NAME = 64;

/** Converte os erros do Zod em `FieldError`s, sem incluir os valores recebidos. */
export function fieldErrors(error: z.ZodError): FieldError[] {
  const result: FieldError[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        result.push({
          field: key.slice(0, MAX_FIELD_NAME),
          code: "unknown_field",
          message: "Campo não permitido.",
        });
      }
      continue;
    }
    const field = issue.path.map(String).join(".").slice(0, MAX_FIELD_NAME);
    result.push({ field: field === "" ? "(body)" : field, code: issue.code, message: issue.message });
  }
  return result;
}

/** Valida com um schema Zod ou lança 400 VALIDATION_ERROR. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProblemError(400, "VALIDATION_ERROR", "Um ou mais campos são inválidos.", fieldErrors(result.error));
  }
  return result.data;
}

export function validationError(field: string, code: string, message: string): ProblemError {
  return new ProblemError(400, "VALIDATION_ERROR", "Um ou mais campos são inválidos.", [
    { field, code, message },
  ]);
}

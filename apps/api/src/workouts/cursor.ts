/**
 * Cursor de paginação do histórico de treinos.
 *
 * - Opaco para o cliente: base64url de JSON `{ v, p, c, i, f, t }`.
 * - Posição = último item da página: `performed_on`, `created_at` (texto UTC com
 *   microssegundos, para desempates exatos) e `id`.
 * - Ligado aos filtros: `f`/`t` têm de ser iguais aos `from`/`to` do pedido; se os
 *   filtros mudarem, o cursor é recusado (400 INVALID_CURSOR) e o cliente recomeça
 *   na primeira página. `limit` pode mudar entre páginas.
 * - Não é assinado e não contém o utilizador: só indica uma posição. A consulta
 *   filtra sempre pelo utilizador da sessão, por isso um cursor nunca dá acesso a
 *   dados de outra pessoa.
 */
import { civilDateSchema, UUID_PATTERN } from "@runflow/shared";
import { z } from "zod";
import { ProblemError } from "../problem.ts";

export const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MICROSECOND_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface CursorPosition {
  readonly performedOn: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface ListFilters {
  readonly from: string | null;
  readonly to: string | null;
}

const cursorSchema = z.strictObject({
  v: z.literal(1),
  p: civilDateSchema,
  c: z.string().regex(MICROSECOND_UTC),
  i: z.string().regex(UUID_PATTERN),
  f: civilDateSchema.nullable(),
  t: civilDateSchema.nullable(),
});

export function encodeCursor(position: CursorPosition, filters: ListFilters): string {
  const payload = {
    v: 1,
    p: position.performedOn,
    c: position.createdAt,
    i: position.id,
    f: filters.from,
    t: filters.to,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function invalidCursor(detail = "Cursor inválido. Recomece na primeira página."): ProblemError {
  return new ProblemError(400, "INVALID_CURSOR", detail);
}

export function decodeCursor(raw: string, filters: ListFilters): CursorPosition {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalidCursor();
  }
  const cursor = result.data;
  if (cursor.f !== filters.from || cursor.t !== filters.to) {
    throw invalidCursor("O cursor pertence a outros filtros. Recomece na primeira página.");
  }
  return { performedOn: cursor.p, createdAt: cursor.c, id: cursor.i };
}

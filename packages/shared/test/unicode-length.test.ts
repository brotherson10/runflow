import { describe, expect, it } from "vitest";
import {
  LIMITS,
  codePointLength,
  goalTitleSchema,
  notesSchema,
  userNameSchema,
} from "../src/schemas.ts";
import { UNICODE_SAMPLES } from "./fixtures/unicode-samples.ts";

// Os mesmos casos são verificados contra o `char_length` do PostgreSQL em
// apps/api/test/db/unicode-length.db.test.ts. Unidade: code points, não grafemas.

describe("codePointLength", () => {
  it.each(UNICODE_SAMPLES)("$label conta $codePoints", ({ value, codePoints }) => {
    expect(codePointLength(value)).toBe(codePoints);
  });

  it("difere de String.length (unidades UTF-16) em caracteres fora do BMP", () => {
    expect("🏃".length).toBe(2);
    expect(codePointLength("🏃")).toBe(1);
  });
});

describe("limites com caracteres combinados e emojis", () => {
  it("título: 80 code points aceites, 81 rejeitados, mesmo com emojis compostos", () => {
    // 16 famílias × 5 code points = 80.
    const families = "👨‍👩‍👧".repeat(16);
    expect(codePointLength(families)).toBe(LIMITS.goalTitleLength.max);
    expect(goalTitleSchema.safeParse(families).success).toBe(true);
    expect(goalTitleSchema.safeParse(`${families}a`).success).toBe(false);
  });

  it("observações: acentos decompostos contam 2 por letra", () => {
    const decomposed = "é".repeat(LIMITS.notesMaxLength / 2);
    expect(codePointLength(decomposed)).toBe(LIMITS.notesMaxLength);
    expect(notesSchema.safeParse(decomposed).success).toBe(true);
    expect(notesSchema.safeParse(`${decomposed}e`).success).toBe(false);
    // A forma composta (NFC) do mesmo texto ocupa metade dos code points.
    expect(codePointLength(decomposed.normalize("NFC"))).toBe(LIMITS.notesMaxLength / 2);
  });

  it("nome: 60 bandeiras ocupam 120 code points e são rejeitadas", () => {
    expect(userNameSchema.safeParse("🇵🇹".repeat(30)).success).toBe(true);
    expect(userNameSchema.safeParse("🇵🇹".repeat(31)).success).toBe(false);
  });
});

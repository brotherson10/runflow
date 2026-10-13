import { describe, expect, it } from "vitest";
import { isIanaTimeZone } from "../src/civil-date.ts";
import { LIMITS, timeZoneSchema, userNameSchema } from "../src/schemas.ts";

describe("userNameSchema", () => {
  it("faz trim e aceita até 60 caracteres", () => {
    expect(userNameSchema.parse("  Ana Corredora  ")).toBe("Ana Corredora");
    expect(userNameSchema.safeParse("a".repeat(LIMITS.userNameLength.max)).success).toBe(true);
    expect(userNameSchema.safeParse("a".repeat(LIMITS.userNameLength.max + 1)).success).toBe(false);
  });

  it.each(["", "   ", "Ana\nCorredora", "Ana\u0000", "Ana\tC"])("rejeita %j", (value) => {
    expect(userNameSchema.safeParse(value).success).toBe(false);
  });

  it("guarda HTML como texto literal (escape é na saída)", () => {
    expect(userNameSchema.parse("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });

  it.each([123, null, undefined, ["Ana"], { name: "Ana" }])("rejeita tipo %j", (value) => {
    expect(userNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("timeZoneSchema", () => {
  it.each(["Europe/Lisbon", "Atlantic/Azores", "America/Sao_Paulo", "Pacific/Kiritimati", "UTC"])(
    "aceita %s",
    (value) => {
      expect(timeZoneSchema.safeParse(value).success).toBe(true);
      expect(isIanaTimeZone(value)).toBe(true);
    },
  );

  it.each([
    "",
    "Marte/Base",
    "+01:00",
    "-05:00",
    "europe/lisbon",
    "Europe/Lisbon ",
    "GMT+1",
    "x".repeat(LIMITS.timeZoneMaxLength + 1),
  ])("rejeita %j", (value) => {
    expect(timeZoneSchema.safeParse(value).success).toBe(false);
  });

  it.each([0, null, ["Europe/Lisbon"]])("rejeita tipo %j", (value) => {
    expect(timeZoneSchema.safeParse(value).success).toBe(false);
  });
});

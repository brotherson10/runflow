import { describe, expect, it } from "vitest";
import {
  isCivilDateInFuture,
  isValidCivilDate,
  isValidTimeZone,
  parseCivilDate,
  todayInTimeZone,
} from "../src/civil-date.ts";

describe("isValidCivilDate", () => {
  it.each(["2026-10-12", "2024-02-29", "2000-02-29", "1970-01-01", "2026-12-31"])(
    "aceita %s",
    (value) => {
      expect(isValidCivilDate(value)).toBe(true);
    },
  );

  it.each([
    "2026-02-30",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "0000-01-01",
    "2026-1-5",
    "26-10-12",
    "2026/10/12",
    " 2026-10-12",
    "2026-10-12 ",
    "2026-10-12T00:00:00Z",
    "",
  ])("rejeita %j", (value) => {
    expect(isValidCivilDate(value)).toBe(false);
  });

  it("devolve as partes sem passar por Date", () => {
    expect(parseCivilDate("2026-03-29")).toEqual({ year: 2026, month: 3, day: 29 });
  });
});

describe("fuso horário", () => {
  it("valida identificadores IANA", () => {
    expect(isValidTimeZone("Europe/Lisbon")).toBe(true);
    expect(isValidTimeZone("Pacific/Kiritimati")).toBe(true);
    expect(isValidTimeZone("Marte/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("calcula o dia civil no fuso do utilizador", () => {
    const now = new Date("2026-10-12T11:00:00Z");
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-12");
    expect(todayInTimeZone("Pacific/Kiritimati", now)).toBe("2026-10-13");
    expect(todayInTimeZone("America/Los_Angeles", new Date("2026-10-13T06:30:00Z"))).toBe(
      "2026-10-12",
    );
  });

  it("rejeita fuso inválido", () => {
    expect(() => todayInTimeZone("Marte/Base")).toThrow(RangeError);
  });
});

describe("isCivilDateInFuture (regra separada dos schemas)", () => {
  it("aceita 'hoje' em UTC+14 quando em UTC ainda é ontem", () => {
    const now = new Date("2026-10-12T11:00:00Z");
    expect(isCivilDateInFuture("2026-10-13", { timeZone: "Pacific/Kiritimati", now })).toBe(false);
    expect(isCivilDateInFuture("2026-10-13", { timeZone: "UTC", now })).toBe(true);
  });

  it("não desloca o dia às 23:30 em Los Angeles", () => {
    const now = new Date("2026-10-13T06:30:00Z");
    expect(isCivilDateInFuture("2026-10-12", { timeZone: "America/Los_Angeles", now })).toBe(
      false,
    );
    expect(isCivilDateInFuture("2026-10-13", { timeZone: "America/Los_Angeles", now })).toBe(true);
  });

  it("mantém o dia na mudança de hora europeia", () => {
    const now = new Date("2026-03-29T00:30:00Z");
    expect(todayInTimeZone("Europe/Lisbon", now)).toBe("2026-03-29");
    expect(isCivilDateInFuture("2026-03-29", { timeZone: "Europe/Lisbon", now })).toBe(false);
  });

  it("rejeita data inexistente", () => {
    expect(() => isCivilDateInFuture("2026-02-30", { timeZone: "UTC" })).toThrow(RangeError);
  });
});

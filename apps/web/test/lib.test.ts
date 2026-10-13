import { describe, expect, it } from "vitest";
import { addDays, presetPeriod } from "../src/lib/dates.ts";
import {
  formatCivilDate,
  formatWeekday,
  formatDistance,
  formatDuration,
  formatPace,
  metersToKmInput,
  parseDuration,
  parseKilometers,
  splitDuration,
} from "../src/lib/format.ts";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "../src/lib/redirect.ts";
import { passwordLengthError } from "../src/lib/password.ts";
import { readResetToken, readVerificationToken } from "../src/lib/reset-token.ts";

describe("formatação PT-PT", () => {
  it("distância em km", () => {
    expect(formatDistance(10000)).toBe("10 km");
    expect(formatDistance(10500)).toBe("10,5 km");
    expect(formatDistance(21097)).toBe("21,1 km");
  });

  it.each([
    [1500, "25 min"],
    [3900, "1 h 05 min"],
    [3930, "1 h 05 min 30 s"],
    [45, "45 s"],
    [0, "0 s"],
    [7200, "2 h 00 min"],
  ])("duração %d s → %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it("ritmo m:ss /km e — sem distância", () => {
    expect(formatPace(340)).toBe("5:40 /km");
    expect(formatPace(305)).toBe("5:05 /km");
    expect(formatPace(null)).toBe("—");
  });

  it("datas civis formatadas a partir das partes (independente do fuso do browser)", () => {
    expect(formatCivilDate("2026-03-29")).toBe("29 mar. 2026");
    expect(formatCivilDate("2026-01-01")).toBe("1 jan. 2026");
    expect(formatWeekday("2026-03-29")).toBe("dom.");
    expect(formatWeekday("2026-10-12")).toBe("seg.");
    expect(formatCivilDate("2026-02-30")).toBe("2026-02-30");
  });
});

describe("leitura de valores do utilizador", () => {
  it.each([
    ["10", 10000],
    ["10,5", 10500],
    ["10.25", 10250],
    [" 5,005 ", 5005],
    ["0,001", 1],
  ])("km %j → %d m", (input, meters) => {
    expect(parseKilometers(input)).toBe(meters);
  });

  it.each(["", "0", "-1", "abc", "10,1234", "1e3", "10 km", "12345"])("km inválido %j", (input) => {
    expect(parseKilometers(input)).toBeNull();
  });

  it("ida e volta metros ↔ texto", () => {
    expect(metersToKmInput(10500)).toBe("10,5");
    expect(parseKilometers(metersToKmInput(21097))).toBe(21097);
  });

  it("duração h/m/s", () => {
    expect(parseDuration("1", "5", "30")).toBe(3930);
    expect(parseDuration("", "25", "")).toBe(1500);
    expect(parseDuration("", "", "")).toBeNull();
    expect(parseDuration("0", "60", "0")).toBeNull();
    expect(parseDuration("0", "0", "60")).toBeNull();
    expect(parseDuration("x", "1", "1")).toBeNull();
    expect(splitDuration(3930)).toEqual({ hours: "1", minutes: "5", seconds: "30" });
  });
});

describe("datas civis", () => {
  it("addDays atravessa meses, anos e mudanças de hora sem deslocar", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("presets terminam em hoje", () => {
    expect(presetPeriod("7d", "2026-10-12")).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(presetPeriod("30d", "2026-10-12")).toEqual({ from: "2026-09-13", to: "2026-10-12" });
    expect(presetPeriod("month", "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(presetPeriod("year", "2026-10-12")).toEqual({ from: "2026-01-01", to: "2026-10-12" });
  });
});

describe("safeNextPath (open redirect, por parsing de URL)", () => {
  it.each(["/app", "/app/", "/app/treinos", "/app/treinos?from=2026-10-01", "/app/objetivo#x"])("aceita %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["/app/./treinos", "/app/treinos"],
    ["/app/treinos/../objetivo", "/app/objetivo"],
    ["/app/treinos?x=<b>", "/app/treinos?x=%3Cb%3E"],
  ])("normaliza %s → %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "app",
    "https://evil.example",
    "https://evil.example/app",
    "https://runflow.invalid/app",
    "//evil.example",
    "//evil.example/app",
    "/\\evil.example",
    "/app\\..\\evil",
    "\\\\evil.example/app",
    "/app/\\..\\..\\evil",
    "javascript:alert(1)",
    "/application",
    "/entrar",
    "/apps",
    "/app/../entrar",
    "/app/%2e%2e/entrar",
    "/app/%2E%2E/%2e%2e/evil",
    "/app%2f..%2fentrar",
    "/app\u0000",
    "/app\t/treinos",
    "/app\n",
    `/app/${"x".repeat(600)}`,
  ])("recusa %j", (path) => {
    expect(safeNextPath(path)).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("readResetToken (URLSearchParams + formato)", () => {
  const valid = "AbCdEfGhIjKlMnOpQrStUv12";
  it("aceita o token alfanumérico gerado pelo Better Auth", () => {
    expect(readResetToken(`?token=${valid}`)).toBe(valid);
    expect(readResetToken(new URLSearchParams({ token: valid, other: "1" }))).toBe(valid);
  });

  it.each([
    "",
    "?",
    "?token=",
    "?token=curto",
    `?token=${valid}&token=${valid}`,
    `?token=${valid}%00`,
    `?token=${valid}%2F..`,
    `?token=${valid}<script>`,
    `?token=${"a".repeat(129)}`,
    `?tok=${valid}`,
  ])("recusa %j", (search) => {
    expect(readResetToken(search)).toBeNull();
  });
});

describe("readVerificationToken (JWT do link de confirmação)", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5wdCJ9.c2lnbmF0dXJlLWJhc2U2NHVybA";
  it("aceita um JWT com três segmentos base64url", () => {
    expect(readVerificationToken(`?token=${jwt}`)).toBe(jwt);
  });

  it.each([
    "",
    "?token=",
    "?token=abc",
    "?token=a.b",
    `?token=${jwt}&token=${jwt}`,
    `?token=${jwt}.extra`,
    `?token=${jwt}%3Cscript%3E`,
    `?token=${"a".repeat(1100)}.${"b".repeat(1000)}.c`,
  ])("recusa %j", (search) => {
    expect(readVerificationToken(search)).toBeNull();
  });
});

describe("passwordLengthError (15–128, sem composição)", () => {
  it.each([
    ["a".repeat(14), /pelo menos 15/],
    ["😀".repeat(14), /pelo menos 15/],
    ["x".repeat(129), /no máximo 128/],
    ["😀".repeat(65), /no máximo 128/],
  ])("recusa %j", (password, message) => {
    expect(passwordLengthError(password)).toMatch(message);
  });

  it.each(["a".repeat(15), "uma frase longa sem regras", "😀".repeat(15), "x".repeat(128)])("aceita %j", (password) => {
    expect(passwordLengthError(password)).toBeNull();
  });
});

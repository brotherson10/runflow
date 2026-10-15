import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_ORIGIN,
  DEFAULT_WEB_DIST_DIR,
  DEFAULT_PORT,
  readApiRateLimit,
  readConfig,
  readRateLimitPurgeIntervalS,
  readServerConfig,
  readTrustProxy,
} from "../src/config.ts";

describe("readConfig", () => {
  it("usa a porta por omissão sem PORT", () => {
    expect(readConfig({})).toEqual({ port: DEFAULT_PORT });
    expect(readConfig({ PORT: "  " })).toEqual({ port: DEFAULT_PORT });
  });

  it("lê PORT do ambiente", () => {
    expect(readConfig({ PORT: "4000" })).toEqual({ port: 4000 });
    expect(readConfig({ PORT: "0" })).toEqual({ port: 0 });
  });

  it.each(["abc", "-1", "3000.5", "65536", "3000abc"])("rejeita PORT=%j", (value) => {
    expect(() => readConfig({ PORT: value })).toThrow(/PORT inválida/);
  });
});

const DB = "postgres://u:p@127.0.0.1:55432/runflow_dev";
const SECRET = "s".repeat(40);

describe("readServerConfig", () => {
  it("desenvolvimento: valores locais por omissão e segredo efémero gerado", () => {
    const config = readServerConfig({ DATABASE_URL: DB }, () => "gerado-".repeat(8));
    expect(config).toMatchObject({
      nodeEnv: "development",
      isProduction: false,
      appOrigin: DEFAULT_APP_ORIGIN,
      authSecret: "gerado-".repeat(8),
      authSecretIsEphemeral: true,
      trustProxy: false,
      passwordBreachCheck: "hibp",
      webDistDir: null,
    });
  });

  it("o segredo por omissão é aleatório (não fixo)", () => {
    const a = readServerConfig({ DATABASE_URL: DB });
    const b = readServerConfig({ DATABASE_URL: DB });
    expect(a.authSecret).not.toBe(b.authSecret);
    expect(a.authSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("lê a configuração explícita", () => {
    const config = readServerConfig({
      DATABASE_URL: DB,
      BETTER_AUTH_SECRET: SECRET,
      APP_URL: "http://localhost:4173",
      TRUST_PROXY: "loopback",
      NODE_ENV: "test",
    });
    expect(config).toMatchObject({
      nodeEnv: "test",
      appOrigin: "http://localhost:4173",
      authSecret: SECRET,
      authSecretIsEphemeral: false,
      trustProxy: "loopback",
    });
  });

  it.each([
    ["sem DATABASE_URL", {}, /DATABASE_URL/],
    ["segredo curto", { DATABASE_URL: DB, BETTER_AUTH_SECRET: "curto" }, /pelo menos 32/],
    ["test sem segredo", { DATABASE_URL: DB, NODE_ENV: "test" }, /BETTER_AUTH_SECRET é obrigatória/],
    ["NODE_ENV inválido", { DATABASE_URL: DB, NODE_ENV: "staging" }, /NODE_ENV inválido/],
    ["APP_URL com caminho", { DATABASE_URL: DB, APP_URL: "http://localhost:5173/app" }, /só a origem/],
    ["APP_URL inválida", { DATABASE_URL: DB, APP_URL: "ftp://x" }, /APP_URL/],
    ["TRUST_PROXY=true", { DATABASE_URL: DB, TRUST_PROXY: "true" }, /TRUST_PROXY=true/],
    ["HIBP com valor inválido", { DATABASE_URL: DB, PASSWORD_BREACH_CHECK: "talvez" }, /PASSWORD_BREACH_CHECK/],
    ["WEB_DIST_DIR relativa", { DATABASE_URL: DB, WEB_DIST_DIR: "apps/web/dist" }, /absoluto/],
  ])("falha com %s", (_label, env, message) => {
    expect(() => readServerConfig(env)).toThrow(message);
  });

  describe("produção falha se faltar configuração obrigatória", () => {
    const production = {
      NODE_ENV: "production",
      DATABASE_URL: DB,
      BETTER_AUTH_SECRET: SECRET,
      APP_URL: "https://runflow.example",
    };

    it("configuração completa sem e-mail: HIBP ligado e build da web por omissão", () => {
      const config = readServerConfig(production);
      expect(config).toMatchObject({
        isProduction: true,
        passwordBreachCheck: "hibp",
        webDistDir: DEFAULT_WEB_DIST_DIR,
      });
    });

    it("não exige nem lê variáveis de e-mail (projeto demonstrativo sem e-mail)", () => {
      const config = readServerConfig({ ...production, MAIL_TRANSPORT: "smtp", RESEND_API_KEY: "x" });
      expect(Object.keys(config)).not.toContain("mail");
    });

    it.each([
      ["sem BETTER_AUTH_SECRET", { BETTER_AUTH_SECRET: undefined }, /BETTER_AUTH_SECRET é obrigatória/],
      ["sem APP_URL", { APP_URL: undefined }, /APP_URL é obrigatória/],
      ["APP_URL em http", { APP_URL: "http://runflow.example" }, /https em produção/],
      ["sem DATABASE_URL", { DATABASE_URL: undefined }, /DATABASE_URL/],
      ["HIBP desligado", { PASSWORD_BREACH_CHECK: "off" }, /não é permitido em produção/],
    ])("%s", (_label, override, message) => {
      expect(() => readServerConfig({ ...production, ...override })).toThrow(message);
    });

    it("nunca gera um segredo efémero em produção", () => {
      let generated = false;
      expect(() =>
        readServerConfig({ ...production, BETTER_AUTH_SECRET: undefined }, () => {
          generated = true;
          return "x".repeat(40);
        }),
      ).toThrow();
      expect(generated).toBe(false);
    });
  });
});

describe("readApiRateLimit", () => {
  it("usa os valores por omissão", () => {
    expect(readApiRateLimit({})).toEqual({
      read: { windowS: 60, max: 120 },
      write: { windowS: 60, max: 30 },
    });
  });

  it("lê a configuração do ambiente", () => {
    expect(
      readApiRateLimit({
        API_RATE_LIMIT_WINDOW_S: "30",
        API_RATE_LIMIT_READ_MAX: "50",
        API_RATE_LIMIT_WRITE_MAX: "5",
      }),
    ).toEqual({ read: { windowS: 30, max: 50 }, write: { windowS: 30, max: 5 } });
  });

  it.each([
    { API_RATE_LIMIT_WINDOW_S: "0" },
    { API_RATE_LIMIT_WINDOW_S: "-1" },
    { API_RATE_LIMIT_READ_MAX: "1.5" },
    { API_RATE_LIMIT_WRITE_MAX: "abc" },
    { API_RATE_LIMIT_WINDOW_S: "86401" },
  ])("rejeita %j", (env) => {
    expect(() => readApiRateLimit(env)).toThrow(/tem de ser um inteiro/);
  });
});

describe("readTrustProxy", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["1", 1],
    ["loopback", "loopback"],
    ["10.0.0.1, 10.0.0.2", "10.0.0.1, 10.0.0.2"],
  ])("%j -> %j", (raw, expected) => {
    expect(readTrustProxy(raw)).toEqual(expected);
  });
});

describe("readRateLimitPurgeIntervalS", () => {
  it("1 h por omissão, 0 desliga, aceita 60–86400", () => {
    expect(readRateLimitPurgeIntervalS({})).toBe(3600);
    expect(readRateLimitPurgeIntervalS({ RATE_LIMIT_PURGE_INTERVAL_S: "0" })).toBe(0);
    expect(readRateLimitPurgeIntervalS({ RATE_LIMIT_PURGE_INTERVAL_S: "60" })).toBe(60);
    expect(readRateLimitPurgeIntervalS({ RATE_LIMIT_PURGE_INTERVAL_S: "86400" })).toBe(86_400);
  });

  it.each(["59", "1", "86401", "-1", "1.5", "abc", "00"])("recusa %j", (raw) => {
    expect(() => readRateLimitPurgeIntervalS({ RATE_LIMIT_PURGE_INTERVAL_S: raw })).toThrow(/RATE_LIMIT_PURGE_INTERVAL_S/);
  });
});

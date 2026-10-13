import { describe, expect, it } from "vitest";
import { readDatabaseUrl } from "../src/config.ts";
import { assertSafeTestDatabaseUrl } from "./db/support/test-database.ts";

// Testes unitários (sem base de dados) das proteções da base de testes.

describe("assertSafeTestDatabaseUrl", () => {
  it.each([
    "postgres://u:p@127.0.0.1:55432/runflow_test",
    "postgresql://u:p@localhost:5432/runflow_test",
    "postgres://u:p@[::1]:5432/outra_test",
  ])("aceita %s", (url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    ["base de desenvolvimento", "postgres://u:p@127.0.0.1:55432/runflow_dev"],
    ["nome sem sufixo _test", "postgres://u:p@127.0.0.1:55432/runflow"],
    ["sufixo no meio", "postgres://u:p@127.0.0.1:55432/runflow_test_backup"],
    ["host remoto", "postgres://u:p@db.example.com:5432/runflow_test"],
    ["host Neon", "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/runflow_test"],
    ["sem base", "postgres://u:p@127.0.0.1:55432/"],
    ["caracteres perigosos", 'postgres://u:p@127.0.0.1:55432/x";drop_test'],
    ["protocolo errado", "mysql://u:p@127.0.0.1/runflow_test"],
    ["URL inválido", "não é url"],
  ])("recusa %s", (_label, url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).toThrow();
  });

  it("recusa quando TEST_DATABASE_URL e DATABASE_URL apontam para a mesma base", () => {
    const url = "postgres://u:p@127.0.0.1:55432/runflow_test";
    expect(() => assertSafeTestDatabaseUrl(url, url)).toThrow(/mesma base/);
  });
});

describe("readDatabaseUrl", () => {
  it("lê DATABASE_URL", () => {
    const url = "postgres://u:p@127.0.0.1:55432/runflow_dev";
    expect(readDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it.each([
    [{}, /não está definida/],
    [{ DATABASE_URL: "  " }, /não está definida/],
    [{ DATABASE_URL: "texto" }, /não é um URL válido/],
    [{ DATABASE_URL: "http://127.0.0.1/x" }, /postgres:\/\//],
    [{ DATABASE_URL: "postgres://127.0.0.1:5432" }, /nome da base/],
  ])("rejeita %j", (env, message) => {
    expect(() => readDatabaseUrl(env)).toThrow(message);
  });

  it.each(["http://u:segredo123@127.0.0.1/x", "postgres://u:segredo123@127.0.0.1"])(
    "não inclui a palavra-passe na mensagem de erro (%s)",
    (url) => {
      let message = "";
      try {
        readDatabaseUrl({ DATABASE_URL: url });
      } catch (error) {
        message = String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("segredo123");
    },
  );
});

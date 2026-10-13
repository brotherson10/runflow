import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { freshMigratedTestDatabase, openTestDatabase, resetTestDatabase } from "./support/test-database.ts";

describe("limpeza da base de testes", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("recusa limpar enquanto outra sessão tem uma transação aberta (em vez de bloquear)", async () => {
    const other = openTestDatabase();
    const client = await other.pool.connect();
    try {
      await client.query("begin");
      await client.query("select count(*) from workouts");
      await expect(resetTestDatabase(handle)).rejects.toThrow(/transações abertas/);
      await client.query("rollback");
    } finally {
      client.release();
      await other.close();
    }
    // Sem transações pendentes, a limpeza volta a funcionar.
    await expect(resetTestDatabase(handle)).resolves.toBeUndefined();
  });
});

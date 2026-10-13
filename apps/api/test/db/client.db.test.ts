import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openTestDatabase } from "./support/test-database.ts";

describe("cliente Drizzle", () => {
  it("consulta e fecha todas as conexões; close() é idempotente", async () => {
    const handle = openTestDatabase();
    const result = await handle.db.execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows[0]?.ok).toBe(1);
    expect(handle.pool.totalCount).toBeGreaterThan(0);

    await handle.close();
    await handle.close();

    expect(handle.pool.totalCount).toBe(0);
    expect(handle.pool.ended).toBe(true);
    await expect(handle.db.execute(sql`select 1`)).rejects.toThrow();
  });
});

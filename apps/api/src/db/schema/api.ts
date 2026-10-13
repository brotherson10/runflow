/**
 * Infraestrutura da API de domínio (não pertence ao Better Auth).
 *
 * `api_rate_limit` guarda janelas fixas por chave (bucket + IP do cliente). É
 * separada da tabela `rate_limit` do Better Auth, cuja semântica é definida pela
 * biblioteca e pode mudar numa atualização.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const apiRateLimit = pgTable(
  "api_rate_limit",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [check("api_rate_limit_count_chk", sql`${table.count} >= 1`)],
);

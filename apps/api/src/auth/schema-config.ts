/**
 * Entrada usada APENAS pela CLI oficial (`auth generate`) para derivar o schema
 * Drizzle das tabelas de autenticação a partir da configuração real
 * (`createAuth`): campos adicionais, rate limiting em base de dados, etc.
 *
 * Não monta rotas e não liga à base de dados (`drizzle.mock()`); os valores
 * abaixo são marcadores sem significado fora da geração do schema.
 * Depois de alterar `createAuth`, corra `npm run db:auth:generate` e
 * `npm run db:generate`.
 *
 * IDs: geração por omissão do Better Auth (string) — ver D12 em docs/decisions.md.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema/index.ts";
import { MemoryMailbox } from "../mail/mailer.ts";
import { createAuth } from "./auth.ts";

export const auth = createAuth({
  db: drizzle.mock({ schema }),
  appOrigin: "http://localhost:5173",
  secret: "schema-generation-only-not-a-real-secret-0000",
  isProduction: false,
  mailer: new MemoryMailbox(),
  logger: console,
});

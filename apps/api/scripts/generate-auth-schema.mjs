// Gera src/db/schema/auth.ts com a CLI oficial do Better Auth (`auth generate`)
// e aplica um único passo determinístico: `timestamp(...)` -> `timestamptz`.
//
// Motivo: a CLI 1.7.7 gera `timestamp` sem fuso para PostgreSQL e não tem opção
// para mudar isso; o RunFlow guarda todos os instantes em TIMESTAMPTZ (D13).
// O script falha se o formato gerado mudar, para nunca aplicar a conversão às cegas.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Execute com `npm run db:auth:generate`.");
  process.exit(1);
}

const OUTPUT = "src/db/schema/auth.ts";
const tempDir = mkdtempSync(join(tmpdir(), "runflow-auth-schema-"));
const tempFile = join(tempDir, "auth.ts");

try {
  // A CLI carrega a configuração com o seu próprio resolvedor, que usa o build
  // (`dist`) de @runflow/shared: compilá-lo primeiro evita um build desatualizado.
  const sharedBuild = spawnSync(
    process.execPath,
    [npmCli, "run", "build", "--workspace", "@runflow/shared"],
    { stdio: "inherit" },
  );
  if (sharedBuild.status !== 0) {
    throw new Error("Falha ao compilar @runflow/shared.");
  }

  const result = spawnSync(
    process.execPath,
    [
      npmCli,
      "exec",
      "--no",
      "--",
      "auth",
      "generate",
      "--config",
      "src/auth/schema-config.ts",
      "--output",
      tempFile,
      "--yes",
    ],
    { stdio: "inherit", env: { ...process.env, BETTER_AUTH_TELEMETRY: "0" } },
  );
  if (result.status !== 0) {
    throw new Error(`A CLI do Better Auth terminou com código ${String(result.status)}.`);
  }

  const generated = readFileSync(tempFile, "utf8");
  const bareTimestamp = /timestamp\("([a-z_]+)"\)/g;
  const count = generated.match(bareTimestamp)?.length ?? 0;
  if (count === 0) {
    throw new Error("Formato inesperado: nenhuma coluna `timestamp(\"...\")` encontrada.");
  }

  const converted = generated.replace(bareTimestamp, 'timestamp("$1", { withTimezone: true })');
  if (/timestamp\("[^"]+"\)/.test(converted) || !/withTimezone: true/.test(converted)) {
    throw new Error("Conversão para timestamptz incompleta.");
  }

  const header =
    "// GERADO por `npm run db:auth:generate` — não editar à mão.\n" +
    "// Fonte: CLI oficial do Better Auth (pacote `auth`), configuração em src/auth/schema-config.ts.\n" +
    "// Pós-processamento único: colunas `timestamp` convertidas para `timestamptz` (D13).\n\n";
  writeFileSync(OUTPUT, header + converted);
  console.log(`${OUTPUT}: ${String(count)} colunas convertidas para timestamptz.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

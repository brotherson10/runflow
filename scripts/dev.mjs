// Arranca a API e a web em paralelo (sem dependências extra).
// Ctrl+C termina ambos; se um processo sair, o outro também é terminado.
import { spawn } from "node:child_process";

// Quando corre via `npm run dev`, o npm indica o seu próprio CLI em npm_execpath.
// Invocá-lo com o Node atual evita `shell: true` (e o aviso DEP0190 no Windows).
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Execute com `npm run dev` na raiz do repositório.");
  process.exit(1);
}

const workspaces = ["@runflow/api", "@runflow/web"];

const children = workspaces.map((workspace) =>
  spawn(process.execPath, [npmCli, "run", "dev", "--workspace", workspace], {
    stdio: "inherit",
  }),
);

let shuttingDown = false;

function stopAll(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("exit", (code) => {
    stopAll(code ?? 0);
  });
}

process.on("SIGINT", () => {
  stopAll(0);
});
process.on("SIGTERM", () => {
  stopAll(0);
});

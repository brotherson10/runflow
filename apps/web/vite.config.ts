import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
// Import relativo ao código-fonte: a configuração do Vite não depende do build do shared.
import { securityHeaders } from "../../packages/shared/src/security-headers.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  // Lê o .env da raiz só para a configuração (variáveis sem prefixo VITE_
  // nunca chegam ao bundle do cliente).
  const env = loadEnv(mode, repoRoot, "");
  const apiTarget = env["API_PROXY_TARGET"] ?? "http://localhost:3100";

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      // Mesma CSP e headers da publicação (sem HSTS: aqui é HTTP).
      headers: securityHeaders({ https: false }),
      proxy: {
        "/api": { target: apiTarget },
      },
    },
  };
});

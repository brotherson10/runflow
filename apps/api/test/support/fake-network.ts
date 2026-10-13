/**
 * Rede dos testes: substitui `globalThis.fetch` para que NENHUM pedido saia da
 * máquina.
 * - api.pwnedpasswords.com → HIBP simulado (mesmo formato da API real: sufixos
 *   SHA-1 em maiúsculas, "SUFIXO:contagem", com linhas de padding);
 * - loopback (127.0.0.1, localhost, ::1) → fetch real (servidores de teste);
 * - qualquer outro host → erro (falha o teste em vez de contactar a Internet).
 *
 * Usada pelos testes de base de dados (setup do Vitest) e pela API dos E2E
 * (`node --import`); nunca pelo código de produção.
 */
import { createHash } from "node:crypto";

export type HibpMode = "ok" | "unavailable" | "network-error" | "hang";

interface FakeHibpState {
  mode: HibpMode;
  calls: number;
  readonly compromised: Map<string, number>;
  /** Palavras-passe cuja consulta devolve 503 (independentemente de `mode`). */
  readonly failing: Set<string>;
}

export const fakeHibp: FakeHibpState = { mode: "ok", calls: 0, compromised: new Map(), failing: new Set() };

export function resetFakeHibp(): void {
  fakeHibp.mode = "ok";
  fakeHibp.calls = 0;
  fakeHibp.compromised.clear();
  fakeHibp.failing.clear();
}

function sha1(password: string): string {
  return createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const realFetch = globalThis.fetch.bind(globalThis);
let installed = false;

function hibpResponse(prefix: string): Response {
  if (fakeHibp.mode === "unavailable") return new Response("Service Unavailable", { status: 503 });
  for (const password of fakeHibp.failing) {
    if (sha1(password).startsWith(prefix)) return new Response("Service Unavailable", { status: 503 });
  }
  const lines: string[] = [];
  for (const [password, count] of fakeHibp.compromised) {
    const hash = sha1(password);
    if (hash.startsWith(prefix)) lines.push(`${hash.slice(5)}:${String(count)}`);
  }
  // Padding como o do serviço real ("Add-Padding: true"): sufixos com contagem 0.
  lines.push("0000000000000000000000000000000000A:0", "0000000000000000000000000000000000B:0");
  return new Response(lines.join("\r\n"), { status: 200, headers: { "Content-Type": "text/plain" } });
}

export function installFakeNetwork(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init);
    if (url.hostname === "api.pwnedpasswords.com" && url.pathname.startsWith("/range/")) {
      fakeHibp.calls += 1;
      if (fakeHibp.mode === "network-error") return Promise.reject(new TypeError("fetch failed"));
      if (fakeHibp.mode === "hang") return new Promise<Response>(() => undefined);
      return Promise.resolve(hibpResponse(url.pathname.slice("/range/".length).toUpperCase()));
    }
    return Promise.reject(new Error(`Rede externa bloqueada nos testes: ${url.hostname}`));
  };
}

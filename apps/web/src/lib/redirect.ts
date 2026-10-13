/**
 * Destino depois do login (`?next=`). Impede open redirects analisando o valor
 * com o parser de URL do browser (WHATWG), não por prefixos de texto:
 * - tem de ser uma referência relativa à raiz (`/…`), nunca absoluta nem `//host`;
 * - resolvida contra uma origem fixa, tem de manter essa origem;
 * - o caminho JÁ NORMALIZADO (`..`, `.`, `%2e%2e` resolvidos) tem de ser `/app`
 *   ou estar dentro de `/app/`.
 * Devolve o URL re-serializado pelo parser (caminho, query e fragmento), não o
 * texto original. Tudo o resto volta ao painel.
 */
export const DEFAULT_AFTER_LOGIN = "/app";

const MAX_LENGTH = 512;
// Origem fictícia só para resolver referências relativas; nunca é devolvida.
const BASE = new URL("https://runflow.invalid/");

export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return DEFAULT_AFTER_LOGIN;
  // O parser remove tabs/quebras de linha e trata `\` como `/` em silêncio: recusar
  // antes, em vez de aceitar uma forma diferente da que foi enviada.
  // eslint-disable-next-line no-control-regex -- recusar explicitamente caracteres de controlo
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_AFTER_LOGIN;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== BASE.origin) return DEFAULT_AFTER_LOGIN;
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return DEFAULT_AFTER_LOGIN;
  return `${url.pathname}${url.search}${url.hash}`;
}

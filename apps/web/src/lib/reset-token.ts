/**
 * Token do link de redefinição (`/redefinir-senha?token=…`), lido com
 * URLSearchParams. O Better Auth 1.7 gera tokens alfanuméricos de 24 caracteres
 * (`generateId(24)`); aceitamos 16–128 alfanuméricos para tolerar mudanças de
 * tamanho numa atualização, mas nunca outros caracteres, valores repetidos ou
 * vazios. Um token inválido mostra "link não é válido" sem chamar a API.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,128}$/;

export function readResetToken(search: string | URLSearchParams): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const values = params.getAll("token");
  if (values.length !== 1) return null;
  const [token] = values;
  return token !== undefined && TOKEN_PATTERN.test(token) ? token : null;
}

// Token de confirmação de e-mail: JWT do Better Auth (três segmentos base64url).
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_JWT_LENGTH = 2048;

/** Token do link de confirmação (`/confirmar-email?token=…`), com as mesmas regras. */
export function readVerificationToken(search: string | URLSearchParams): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const values = params.getAll("token");
  if (values.length !== 1) return null;
  const [token] = values;
  return token !== undefined && token.length <= MAX_JWT_LENGTH && JWT_PATTERN.test(token) ? token : null;
}

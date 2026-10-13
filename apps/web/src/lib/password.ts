/**
 * Política de palavra-passe na interface (a decisão é sempre do servidor):
 * 15–128 caracteres, sem regras de composição (NIST SP 800-63B-4).
 * - mínimo contado em code points (um emoji conta 1), como recomenda o NIST;
 * - máximo contado como o Better Auth (unidades UTF-16), para a interface nunca
 *   aceitar o que o servidor recusa.
 */
import { codePointLength, LIMITS } from "@runflow/shared";

export const PASSWORD_HINT = `Entre ${String(LIMITS.passwordLength.min)} e ${String(LIMITS.passwordLength.max)} caracteres. Uma frase longa é uma boa opção; não são exigidos números nem símbolos.`;

export function passwordLengthError(password: string): string | null {
  if (codePointLength(password) < LIMITS.passwordLength.min) {
    return `Use pelo menos ${String(LIMITS.passwordLength.min)} caracteres.`;
  }
  if (password.length > LIMITS.passwordLength.max) {
    return `Use no máximo ${String(LIMITS.passwordLength.max)} caracteres.`;
  }
  return null;
}

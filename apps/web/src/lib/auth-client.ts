/**
 * Cliente oficial do Better Auth (mesma origem, /api/auth). O campo adicional
 * `timeZone` é declarado aqui para tipagem; a validação é feita no servidor.
 */
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    inferAdditionalFields({
      user: { timeZone: { type: "string", required: true } },
    }),
  ],
});

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly timeZone: string;
}

/** Erro devolvido pelo cliente do Better Auth (`{ data, error }`). */
export interface AuthErrorLike {
  readonly status?: number;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou palavra-passe incorretos.",
  PASSWORD_TOO_SHORT: "A palavra-passe tem de ter pelo menos 15 caracteres.",
  PASSWORD_TOO_LONG: "A palavra-passe é demasiado longa (máximo 128 caracteres).",
  PASSWORD_COMPROMISED: "Esta palavra-passe aparece em fugas de dados conhecidas. Escolha outra.",
  PASSWORD_CHECK_UNAVAILABLE:
    "Não foi possível verificar a palavra-passe agora. Tente novamente dentro de alguns minutos.",
  EMAIL_NOT_VERIFIED: "Confirme o seu e-mail antes de entrar. Use o link que lhe enviámos ou peça um novo.",
  INVALID_EMAIL: "Indique um e-mail válido.",
  INVALID_NAME: "Indique um nome válido (até 60 caracteres).",
  INVALID_TIME_ZONE: "Fuso horário inválido.",
  INVALID_TOKEN: "O link de recuperação é inválido ou expirou. Peça um novo.",
  INVALID_ORIGIN: "Pedido recusado por segurança. Recarregue a página.",
};

export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return "Ocorreu um erro inesperado.";
  if (error.status === 429) return "Demasiadas tentativas. Aguarde um pouco e tente novamente.";
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code] ?? "";
  if (error.status === undefined || error.status === 0) return "Sem ligação ao servidor. Tente novamente.";
  return "Não foi possível concluir o pedido. Tente novamente.";
}

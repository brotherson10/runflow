/** Constantes partilhadas por playwright.config.ts e pelos testes (sem importar fixtures). */
export const WEB_ORIGIN = "http://localhost:4173";
export const MAIL_DIR = ".e2e/mail";

/**
 * Palavras-passe fictícias reconhecidas pelo HIBP simulado da API dos E2E
 * (e2e/fake-network-preload.ts): nenhuma consulta sai da máquina.
 */
export const E2E_COMPROMISED_PASSWORD = "palavra-passe-ja-divulgada-e2e";
export const E2E_HIBP_FAILING_PASSWORD = "consulta-hibp-indisponivel-e2e";

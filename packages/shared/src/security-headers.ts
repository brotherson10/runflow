/**
 * Cabeçalhos de segurança da web (fonte única). Enviados pelo Express que serve o
 * build (produção e E2E) e pelo `vite preview` (verificação local do build).
 * Ver docs/deployment.md.
 *
 * A CSP não precisa de 'unsafe-inline': o build não tem scripts nem estilos inline
 * e o React aplica `style` via CSSOM. Uma violação aparece como erro na consola,
 * que já faz falhar os E2E.
 */
export interface SecurityHeaderOptions {
  /** Só em HTTPS: HSTS e upgrade-insecure-requests (em http://localhost partiriam a página). */
  readonly https: boolean;
}

export function contentSecurityPolicy({ https }: SecurityHeaderOptions): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ...(options.https ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}

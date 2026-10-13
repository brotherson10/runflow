import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { NavigationType, useNavigationType } from "react-router";

export function Loading({ label = "A carregar…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

/**
 * Título da página. Depois de uma navegação dentro da app (PUSH/REPLACE), recebe o
 * foco (anuncia a nova página a leitores de ecrã). No carregamento inicial e em
 * voltar/avançar (POP) não: o primeiro Tab chega ao link "Saltar para o conteúdo".
 */
export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const focusOnMount = useNavigationType() !== NavigationType.Pop;
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <div className="page-title">
      <h1 ref={ref} tabIndex={-1}>
        {children}
      </h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
}

/** Campo com label, dica e erro ligados por aria-describedby. */
export function Field({ label, error, hint, id, className, ...input }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Erro geral de formulário; recebe o foco para ser anunciado. */
export function FormError({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <div className="form-error" role="alert" tabIndex={-1} ref={ref}>
      {message}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = "A guardar…",
  variant = "primary",
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "danger";
}) {
  return (
    <button
      type="submit"
      className={`button button-${variant}`}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

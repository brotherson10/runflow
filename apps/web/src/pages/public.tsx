import { useState, type SubmitEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Field, FormError, Loading, PageTitle, SubmitButton } from "../components/ui.tsx";
import { authClient, authErrorMessage } from "../lib/auth-client.ts";
import { safeNextPath } from "../lib/redirect.ts";
import { passwordLengthError, PASSWORD_HINT } from "../lib/password.ts";
import { NO_EMAIL_NOTICE } from "../lib/no-email.ts";
import { browserTimeZone, useSession, useSessionActions } from "../lib/session.ts";

export function SignInPage() {
  const session = useSession();
  const { signIn } = useSessionActions();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.isPending) return <Loading />;
  if (session.data) return <Navigate to={next} replace />;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (email.trim() === "" || password === "") {
      setError("Indique o e-mail e a palavra-passe.");
      return;
    }
    setPending(true);
    setError(null);
    const failure = await signIn(email.trim(), password);
    if (failure) {
      setPending(false);
      setError(authErrorMessage(failure));
      return;
    }
    void navigate(next, { replace: true });
  }

  const reason = params.get("motivo");
  return (
    <section className="narrow">
      <PageTitle>Entrar</PageTitle>
      {reason === "sessao" && <p className="notice">A sua sessão terminou. Entre novamente para continuar.</p>}
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={error} />
        <Field label="E-mail" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} />
        <Field label="Palavra-passe" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => { setPassword(e.target.value); }} />
        <SubmitButton pending={pending} pendingLabel="A entrar…">
          Entrar
        </SubmitButton>
      </form>
      <p className="form-links">
        <Link to="/criar-conta">Criar conta</Link>
      </p>
    </section>
  );
}

export function SignUpPage() {
  const session = useSession();
  const { signIn } = useSessionActions();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const timeZone = browserTimeZone();

  if (session.isPending) return <Loading />;
  if (session.data) return <Navigate to="/app" replace />;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors: Record<string, string> = {};
    if (name.trim() === "") errors["name"] = "Indique o seu nome.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors["email"] = "Indique um e-mail válido.";
    const passwordError = passwordLengthError(password);
    if (passwordError) errors["password"] = passwordError;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      timeZone,
    });
    if (signUpError) {
      setPending(false);
      setError(authErrorMessage(signUpError));
      return;
    }
    // O registo não inicia sessão (resposta igual para e-mails novos e existentes,
    // sem enumeração): entrar a seguir.
    const failure = await signIn(email.trim(), password);
    if (failure) {
      setPending(false);
      setError("Não foi possível entrar automaticamente. Se já tinha conta, entre com a sua palavra-passe.");
      return;
    }
    void navigate("/app", { replace: true });
  }

  return (
    <section className="narrow">
      <PageTitle subtitle="Comece a registar os seus treinos.">Criar conta</PageTitle>
      <p className="notice">{NO_EMAIL_NOTICE}</p>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={error} />
        <Field label="Nome" name="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); }} error={fieldErrors["name"]} />
        <Field label="E-mail" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} error={fieldErrors["email"]} />
        <Field
          label="Palavra-passe"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => { setPassword(e.target.value); }}
          hint={PASSWORD_HINT}
          error={fieldErrors["password"]}
        />
        <p className="field-hint">
          Fuso horário: <strong>{timeZone}</strong> (pode alterá-lo depois em Conta).
        </p>
        <SubmitButton pending={pending} pendingLabel="A criar conta…">
          Criar conta
        </SubmitButton>
      </form>
      <p className="form-links">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </section>
  );
}

/**
 * Rotas antigas de confirmação de e-mail e recuperação de palavra-passe: o projeto
 * demonstrativo não envia e-mails (D52). Indisponibilidade clara, sem formulários.
 */
export function EmailFeatureUnavailablePage() {
  return (
    <section className="narrow">
      <PageTitle>Funcionalidade indisponível</PageTitle>
      <p className="notice" role="status">
        Este projeto demonstrativo não envia e-mails: o e-mail não é verificado e não existe recuperação de
        palavra-passe.
      </p>
      <p className="form-links">
        <Link to="/entrar">Entrar</Link>
        <Link to="/criar-conta">Criar conta</Link>
        <Link to="/demo">Ver a demo</Link>
      </p>
    </section>
  );
}

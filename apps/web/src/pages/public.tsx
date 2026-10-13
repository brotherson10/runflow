import { useEffect, useState, type SubmitEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { Field, FormError, Loading, PageTitle, SubmitButton } from "../components/ui.tsx";
import { authClient, authErrorMessage } from "../lib/auth-client.ts";
import { safeNextPath } from "../lib/redirect.ts";
import { passwordLengthError, PASSWORD_HINT } from "../lib/password.ts";
import { readResetToken, readVerificationToken } from "../lib/reset-token.ts";
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
  const [unverified, setUnverified] = useState(false);

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
    setUnverified(false);
    const failure = await signIn(email.trim(), password);
    if (failure) {
      setPending(false);
      setError(authErrorMessage(failure));
      // Só acontece com a palavra-passe certa: oferecer um novo link de confirmação.
      setUnverified(failure.code === "EMAIL_NOT_VERIFIED");
      return;
    }
    void navigate(next, { replace: true });
  }

  const reason = params.get("motivo");
  return (
    <section className="narrow">
      <PageTitle>Entrar</PageTitle>
      {reason === "sessao" && <p className="notice">A sua sessão terminou. Entre novamente para continuar.</p>}
      {params.get("redefinida") === "1" && (
        <p className="notice notice-success">Palavra-passe alterada. Entre com a nova palavra-passe.</p>
      )}
      {params.get("confirmado") === "1" && (
        <p className="notice notice-success">E-mail confirmado. Já pode entrar.</p>
      )}
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={error} />
        {unverified && (
          <p className="form-links">
            <Link to="/verificar-email" state={{ email: email.trim() }}>
              Enviar novo link de confirmação
            </Link>
          </p>
        )}
        <Field label="E-mail" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} />
        <Field label="Palavra-passe" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => { setPassword(e.target.value); }} />
        <SubmitButton pending={pending} pendingLabel="A entrar…">
          Entrar
        </SubmitButton>
      </form>
      <p className="form-links">
        <Link to="/recuperar-acesso">Esqueceu-se da palavra-passe?</Link>
        <Link to="/criar-conta">Criar conta</Link>
      </p>
    </section>
  );
}

export function SignUpPage() {
  const session = useSession();
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
    // O registo não inicia sessão: é preciso confirmar o e-mail. A resposta é igual
    // para e-mails novos e já registados (sem enumeração), e a página seguinte também.
    void navigate("/verificar-email", { replace: true, state: { email: email.trim(), fromSignUp: true } });
  }

  return (
    <section className="narrow">
      <PageTitle subtitle="Comece a registar os seus treinos.">Criar conta</PageTitle>
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

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Indique um e-mail válido.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: requestError } = await authClient.requestPasswordReset({ email: email.trim() });
    setPending(false);
    // Resposta neutra: só falhas de limite ou de ligação são mostradas.
    if (requestError && (requestError.status === 429 || !requestError.status)) {
      setError(authErrorMessage(requestError));
      return;
    }
    setDone(true);
  }

  return (
    <section className="narrow">
      <PageTitle>Recuperar acesso</PageTitle>
      {done ? (
        <p className="notice notice-success" role="status">
          Se existir uma conta com esse e-mail, enviámos um link para definir uma nova palavra-passe. O link é válido
          durante 30 minutos.
        </p>
      ) : (
        <form className="form" onSubmit={(event) => void submit(event)} noValidate>
          <FormError message={error} />
          <Field label="E-mail da conta" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} />
          <SubmitButton pending={pending} pendingLabel="A enviar…">
            Enviar link
          </SubmitButton>
        </form>
      )}
      <p className="form-links">
        <Link to="/entrar">Voltar a entrar</Link>
      </p>
    </section>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // O token é lido uma vez e retirado da barra de endereço.
  const [token] = useState(() => readResetToken(params));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.has("token")) setParams({}, { replace: true });
  }, [params, setParams]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || token === null) return;
    const passwordError = passwordLengthError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirm) {
      setError("As palavras-passe não coincidem.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
    if (resetError) {
      setPending(false);
      setError(authErrorMessage(resetError));
      return;
    }
    // Sem login automático: voltar a entrar com a nova palavra-passe.
    void navigate("/entrar?redefinida=1", { replace: true });
  }

  if (token === null) {
    return (
      <section className="narrow">
        <PageTitle>Redefinir palavra-passe</PageTitle>
        <p className="notice">Este link não é válido. Peça um novo em “Recuperar acesso”.</p>
        <p>
          <Link to="/recuperar-acesso">Recuperar acesso</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="narrow">
      <PageTitle>Nova palavra-passe</PageTitle>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={error} />
        <Field label="Nova palavra-passe" type="password" name="password" autoComplete="new-password" required value={password} onChange={(e) => { setPassword(e.target.value); }} hint={PASSWORD_HINT} />
        <Field label="Confirmar palavra-passe" type="password" name="confirm" autoComplete="new-password" required value={confirm} onChange={(e) => { setConfirm(e.target.value); }} />
        <SubmitButton pending={pending}>Guardar palavra-passe</SubmitButton>
      </form>
      {error?.includes("expirou") && (
        <p className="form-links">
          <Link to="/recuperar-acesso">Pedir novo link</Link>
        </p>
      )}
    </section>
  );
}

interface VerifyEmailState {
  readonly email?: string;
  readonly fromSignUp?: boolean;
}

function readVerifyState(state: unknown): VerifyEmailState {
  if (typeof state !== "object" || state === null) return {};
  const value = state as Record<string, unknown>;
  return {
    ...(typeof value["email"] === "string" ? { email: value["email"] } : {}),
    ...(value["fromSignUp"] === true ? { fromSignUp: true } : {}),
  };
}

/**
 * Depois do registo (ou de um login recusado por falta de confirmação): explica o
 * passo seguinte e permite pedir um novo link. Respostas sempre neutras.
 */
export function VerifyEmailPendingPage() {
  const location = useLocation();
  const [initial] = useState(() => readVerifyState(location.state));
  const [email, setEmail] = useState(initial.email ?? "");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Indique um e-mail válido.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: sendError } = await authClient.sendVerificationEmail({ email: email.trim() });
    setPending(false);
    // Neutro: só limites e falhas de ligação são mostrados.
    if (sendError && (sendError.status === 429 || !sendError.status)) {
      setError(authErrorMessage(sendError));
      return;
    }
    setSent(true);
  }

  return (
    <section className="narrow">
      <PageTitle>Confirme o seu e-mail</PageTitle>
      {initial.fromSignUp && (
        <p className="notice notice-success" role="status">
          Pedido de registo recebido. Se for possível criar a conta com este e-mail, enviámos um link de confirmação
          {initial.email ? (
            <>
              {" "}
              para <strong>{initial.email}</strong>
            </>
          ) : null}
          . O link é válido durante 24 horas.
        </p>
      )}
      <p>Abra o link do e-mail para confirmar o endereço; depois já pode entrar. Não recebeu o e-mail?</p>
      {sent ? (
        <p className="notice notice-success" role="status">
          Se existir uma conta por confirmar com esse e-mail, enviámos um novo link.
        </p>
      ) : (
        <form className="form" onSubmit={(event) => void submit(event)} noValidate>
          <FormError message={error} />
          <Field label="E-mail da conta" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} />
          <SubmitButton pending={pending} pendingLabel="A enviar…">
            Enviar novo link
          </SubmitButton>
        </form>
      )}
      <p className="form-links">
        <Link to="/entrar">Entrar</Link>
      </p>
    </section>
  );
}

type ConfirmState = "ready" | "confirming" | "done" | "expired" | "invalid";

/**
 * Página do link de confirmação. O token é lido uma vez, retirado do endereço e só
 * usado depois de um clique: leitores automáticos de links não confirmam a conta.
 */
export function ConfirmEmailPage() {
  const [params, setParams] = useSearchParams();
  const [token] = useState(() => readVerificationToken(params));
  const [state, setState] = useState<ConfirmState>(token === null ? "invalid" : "ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.has("token")) setParams({}, { replace: true });
  }, [params, setParams]);

  async function confirm() {
    if (token === null || state === "confirming") return;
    setState("confirming");
    setError(null);
    const { error: verifyError } = await authClient.verifyEmail({ query: { token } });
    if (!verifyError) {
      setState("done");
      return;
    }
    if (verifyError.code === "TOKEN_EXPIRED") setState("expired");
    else if (verifyError.status === 401 || verifyError.status === 400) setState("invalid");
    else {
      setState("ready");
      setError(authErrorMessage(verifyError));
    }
  }

  return (
    <section className="narrow">
      <PageTitle>Confirmar e-mail</PageTitle>
      {state === "done" && (
        <>
          <p className="notice notice-success" role="status">
            E-mail confirmado. Já pode entrar.
          </p>
          <p>
            <Link to="/entrar?confirmado=1" className="button button-primary">
              Entrar
            </Link>
          </p>
        </>
      )}
      {(state === "expired" || state === "invalid") && (
        <>
          <p className="notice" role="alert">
            {state === "expired" ? "Este link de confirmação expirou." : "Este link de confirmação não é válido."} Peça
            um novo link.
          </p>
          <p>
            <Link to="/verificar-email">Pedir novo link</Link>
          </p>
        </>
      )}
      {(state === "ready" || state === "confirming") && (
        <>
          <p>Confirme que este é o seu endereço de e-mail para ativar a conta.</p>
          <FormError message={error} />
          <button
            type="button"
            className="button button-primary"
            onClick={() => void confirm()}
            disabled={state === "confirming"}
          >
            {state === "confirming" ? "A confirmar…" : "Confirmar e-mail"}
          </button>
        </>
      )}
    </section>
  );
}

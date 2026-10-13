import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ToastProvider } from "../components/Toast.tsx";
import { ErrorState, Loading } from "../components/ui.tsx";
import type { SessionUser } from "../lib/auth-client.ts";
import { SESSION_EXPIRED_KEY, SIGNED_OUT_KEY } from "../lib/query.ts";
import { useSession, useSessionActions } from "../lib/session.ts";
import { Brand, SkipLink } from "./shell.tsx";

export interface AppContext {
  readonly user: SessionUser;
}

const APP_NAV = [
  { to: "/app", label: "Painel", end: true },
  { to: "/app/treinos", label: "Treinos", end: false },
  { to: "/app/objetivo", label: "Objetivo", end: false },
  { to: "/app/conta", label: "Conta", end: false },
];

/**
 * Área protegida. Sem sessão, redireciona UMA vez para /entrar com `next`
 * (a página de login não faz pedidos protegidos, por isso não há ciclos).
 */
export function AppLayout() {
  const session = useSession();
  const location = useLocation();
  const client = useQueryClient();

  if (session.isPending) return <Loading label="A verificar a sessão…" />;
  if (session.isError) {
    return (
      <main id="conteudo" className="container main">
        <ErrorState
          message="Não foi possível contactar o servidor."
          onRetry={() => {
            void session.refetch();
          }}
        />
      </main>
    );
  }
  if (!session.data) {
    // Logout voluntário: sem `next` (não regressar à página de onde se saiu).
    if (client.getQueryData<boolean>(SIGNED_OUT_KEY) === true) return <Navigate to="/entrar" replace />;
    const expired = client.getQueryData<boolean>(SESSION_EXPIRED_KEY) === true;
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/entrar?next=${next}${expired ? "&motivo=sessao" : ""}`} replace />;
  }

  return <SignedInShell user={session.data.user} />;
}

function SignedInShell({ user }: { user: SessionUser }) {
  const { signOut } = useSessionActions();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    if (leaving) return;
    setLeaving(true);
    await signOut();
    void navigate("/entrar", { replace: true });
  }

  const context: AppContext = { user };
  return (
    <ToastProvider>
      <SkipLink />
      <header className="site-header app-header">
        <div className="container header-inner">
          <Brand to="/app" />
          <nav aria-label="Área pessoal" className="nav nav-app">
            {APP_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-user">
            <span className="user-name">{user.name}</span>
            <button type="button" className="button button-small button-ghost" onClick={() => void logout()} disabled={leaving}>
              {leaving ? "A sair…" : "Terminar sessão"}
            </button>
          </div>
        </div>
      </header>
      <main id="conteudo" className="container main">
        <Outlet context={context} />
      </main>
    </ToastProvider>
  );
}

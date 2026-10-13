/** Estrutura partilhada e eager: sem Better Auth nem React Query (entra no chunk inicial). */
import { Link, NavLink, Outlet } from "react-router";
import { ErrorState, Loading } from "../components/ui.tsx";

export function SkipLink() {
  return (
    <a className="skip-link" href="#conteudo">
      Saltar para o conteúdo
    </a>
  );
}

export function Brand({ to }: { to: string }) {
  return (
    <Link to={to} className="brand" aria-label="RunFlow — início">
      <span className="brand-mark" aria-hidden="true" />
      RunFlow
    </Link>
  );
}

export function PublicLayout() {
  return (
    <>
      <SkipLink />
      <header className="site-header">
        <div className="container header-inner">
          <Brand to="/" />
          <nav aria-label="Principal" className="nav nav-public">
            <NavLink to="/demo">Demo</NavLink>
            <NavLink to="/entrar">Entrar</NavLink>
            <Link to="/criar-conta" className="button button-small button-primary">
              Criar conta
            </Link>
          </nav>
        </div>
      </header>
      <main id="conteudo" className="container main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>RunFlow V2 — evolução do projeto desenvolvido no estágio DecodeLabs.</p>
        </div>
      </footer>
    </>
  );
}

export function NotFoundPage() {
  return (
    <section className="narrow">
      <h1>Página não encontrada</h1>
      <p>O endereço não existe.</p>
      <p>
        <Link to="/">Voltar ao início</Link>
      </p>
    </section>
  );
}

/** Erro inesperado de renderização: mensagem genérica, sem detalhes internos. */
export function RouteErrorPage() {
  return (
    <main id="conteudo" className="container main">
      <ErrorState
        message="Ocorreu um erro inesperado nesta página."
        onRetry={() => {
          window.location.reload();
        }}
      />
    </main>
  );
}

/** Enquanto o chunk de uma rota carrega (primeira navegação para essa área). */
export function RouteLoading() {
  return <Loading />;
}

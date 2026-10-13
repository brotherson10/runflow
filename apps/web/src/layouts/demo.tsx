import { Link, NavLink, Outlet } from "react-router";
import { Brand, SkipLink } from "./shell.tsx";

const DEMO_NAV = [
  { to: "/demo", label: "Painel", end: true },
  { to: "/demo/treinos", label: "Treinos", end: false },
  { to: "/demo/objetivo", label: "Objetivo", end: false },
];

/** Demo: dados fictícios locais, sem sessão, sem pedidos e só de leitura. */
export function DemoLayout() {
  return (
    <>
      <SkipLink />
      <div className="demo-banner" role="note">
        <div className="container">
          <strong>Modo demonstração</strong> — dados fictícios, só de leitura. Nada do que vê é de uma conta real.{" "}
          <Link to="/criar-conta">Criar conta</Link>
        </div>
      </div>
      <header className="site-header app-header">
        <div className="container header-inner">
          <Brand to="/" />
          <nav aria-label="Demonstração" className="nav nav-app">
            {DEMO_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-user">
            <Link to="/entrar" className="button button-small button-ghost">
              Entrar
            </Link>
          </div>
        </div>
      </header>
      <main id="conteudo" className="container main">
        <Outlet />
      </main>
    </>
  );
}

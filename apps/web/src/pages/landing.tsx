import { Link } from "react-router";

export function LandingPage() {
  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Acompanhamento pessoal de corrida</p>
        <h1>Corra com consistência. Veja o progresso com clareza.</h1>
        <p className="lead">
          Registe cada treino, defina a próxima prova como objetivo e acompanhe distância, tempo e ritmo médio por
          período — tudo num só lugar, sem ruído.
        </p>
        <div className="hero-actions">
          <Link to="/demo" className="button button-primary">
            Ver a demo
          </Link>
          <Link to="/criar-conta" className="button button-secondary">
            Criar conta
          </Link>
          <Link to="/entrar" className="button button-ghost">
            Entrar
          </Link>
        </div>
      </section>
      <section className="features" aria-labelledby="funcionalidades">
        <h2 id="funcionalidades" className="visually-hidden">
          Funcionalidades
        </h2>
        <article className="feature">
          <h3>Histórico de treinos</h3>
          <p>Data, distância em km, duração e notas, com filtros por período.</p>
        </article>
        <article className="feature">
          <h3>Um objetivo de cada vez</h3>
          <p>A prova que está a preparar, com distância e data-alvo opcionais.</p>
        </article>
        <article className="feature">
          <h3>Painel do período</h3>
          <p>Distância total, número de treinos, tempo acumulado e ritmo médio.</p>
        </article>
      </section>
    </div>
  );
}

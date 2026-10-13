/**
 * Demo só de leitura: mesmos componentes de apresentação da área autenticada,
 * alimentados por fixtures locais. Sem pedidos, sem sessão, sem ações de escrita.
 */
import { summarizeWorkouts } from "@runflow/shared";
import { useState } from "react";
import { GoalCard, PeriodPicker, PeriodRange, TotalsGrid, WorkoutList } from "../components/presentation.tsx";
import { EmptyState, PageTitle } from "../components/ui.tsx";
import { DEMO_GOAL, DEMO_TODAY, DEMO_USER, DEMO_WORKOUTS } from "../demo/fixtures.ts";
import type { Totals } from "../lib/api.ts";
import { presetPeriod, type PeriodPreset } from "../lib/dates.ts";

function totalsFor(from: string, to: string): Totals {
  const inPeriod = DEMO_WORKOUTS.filter((item) => item.performedOn >= from && item.performedOn <= to);
  const summary = summarizeWorkouts(inPeriod);
  return {
    workoutCount: summary.workoutCount,
    distanceM: summary.totalDistanceM,
    durationS: summary.totalDurationS,
    paceSPerKm: summary.averagePaceSPerKm,
  };
}

export function DemoDashboardPage() {
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const period = presetPeriod(preset, DEMO_TODAY);
  return (
    <>
      <PageTitle subtitle={`Conta fictícia · Fuso horário: ${DEMO_USER.timeZone}`}>Olá, {DEMO_USER.name}</PageTitle>
      <div className="toolbar">
        <PeriodPicker value={preset} onChange={setPreset} />
      </div>
      <section className="panel" aria-labelledby="resumo">
        <div className="panel-header">
          <h2 id="resumo">Resumo do período</h2>
          <PeriodRange from={period.from} to={period.to} />
        </div>
        <TotalsGrid totals={totalsFor(period.from, period.to)} />
      </section>
      <div className="grid-2">
        <section className="panel" aria-labelledby="objetivo-resumo">
          <h2 id="objetivo-resumo">Objetivo</h2>
          <GoalCard goal={DEMO_GOAL} />
        </section>
        <section className="panel" aria-labelledby="recentes">
          <h2 id="recentes">Treinos recentes</h2>
          <WorkoutList items={DEMO_WORKOUTS.slice(0, 5)} />
        </section>
      </div>
    </>
  );
}

const DEMO_PAGE = 5;

export function DemoWorkoutsPage() {
  const [visible, setVisible] = useState(DEMO_PAGE);
  return (
    <>
      <PageTitle subtitle="Histórico fictício, só de leitura.">Treinos</PageTitle>
      {DEMO_WORKOUTS.length === 0 ? (
        <EmptyState title="Sem treinos." />
      ) : (
        <>
          <WorkoutList items={DEMO_WORKOUTS.slice(0, visible)} />
          {visible < DEMO_WORKOUTS.length && (
            <button type="button" className="button button-secondary load-more" onClick={() => { setVisible((n) => n + DEMO_PAGE); }}>
              Carregar mais
            </button>
          )}
        </>
      )}
    </>
  );
}

export function DemoGoalPage() {
  return (
    <>
      <PageTitle subtitle="Na sua conta, pode editar, concluir ou substituir o objetivo.">Objetivo</PageTitle>
      <GoalCard goal={DEMO_GOAL} />
    </>
  );
}

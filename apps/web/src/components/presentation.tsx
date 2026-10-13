/**
 * Componentes de apresentação partilhados pela área autenticada e pela demo.
 * Recebem dados prontos; não fazem pedidos. Todo o texto do utilizador é
 * renderizado como texto (sem HTML).
 */
import type { ReactNode } from "react";
import type { Goal, Totals, Workout } from "../lib/api.ts";
import { PERIOD_LABELS, type PeriodPreset } from "../lib/dates.ts";
import {
  formatCivilDate,
  formatDistance,
  formatDuration,
  formatPace,
  formatWeekday,
} from "../lib/format.ts";
import { averagePaceSecondsPerKm } from "@runflow/shared";

export function TotalsGrid({ totals }: { totals: Totals }) {
  const items = [
    { label: "Distância", value: formatDistance(totals.distanceM) },
    { label: "Treinos", value: String(totals.workoutCount) },
    { label: "Tempo total", value: formatDuration(totals.durationS) },
    { label: "Ritmo médio", value: formatPace(totals.paceSPerKm) },
  ];
  return (
    <dl className="stats">
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PeriodPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className="visually-hidden">Período</legend>
      {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((preset) => (
        <label key={preset} className={preset === value ? "is-selected" : undefined}>
          <input
            type="radio"
            name="period"
            value={preset}
            checked={preset === value}
            onChange={() => {
              onChange(preset);
            }}
          />
          <span>{PERIOD_LABELS[preset]}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function PeriodRange({ from, to }: { from: string; to: string }) {
  return (
    <p className="period-range">
      {formatCivilDate(from)} – {formatCivilDate(to)}
    </p>
  );
}

/** Lista de treinos. `actions` (opcional) só existe na área autenticada. */
export function WorkoutList({
  items,
  actions,
}: {
  items: readonly Workout[];
  actions?: (workout: Workout) => ReactNode;
}) {
  return (
    <ul className="workout-list">
      {items.map((workout) => {
        const pace = averagePaceSecondsPerKm(workout.durationS, workout.distanceM);
        return (
          <li key={workout.id} className="workout">
            <div className="workout-date">
              <span className="workout-weekday">{formatWeekday(workout.performedOn)}</span>
              <time dateTime={workout.performedOn}>{formatCivilDate(workout.performedOn)}</time>
            </div>
            <div className="workout-main">
              <p className="workout-metrics">
                <strong>{formatDistance(workout.distanceM)}</strong>
                <span>{formatDuration(workout.durationS)}</span>
                <span>{formatPace(pace)}</span>
              </p>
              {workout.notes !== null && <p className="workout-notes">{workout.notes}</p>}
            </div>
            {actions && <div className="workout-actions">{actions(workout)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_LABELS: Record<Goal["status"], string> = {
  active: "Ativo",
  completed: "Concluído",
  replaced: "Substituído",
};

export function GoalCard({ goal, children }: { goal: Goal; children?: ReactNode }) {
  return (
    <article className="goal-card" aria-labelledby={`goal-${goal.id}`}>
      <p className="goal-status">{STATUS_LABELS[goal.status]}</p>
      <h2 id={`goal-${goal.id}`} className="goal-title">
        {goal.title}
      </h2>
      <dl className="goal-details">
        <div>
          <dt>Distância da prova</dt>
          <dd>{formatDistance(goal.targetDistanceM)}</dd>
        </div>
        <div>
          <dt>Data-alvo</dt>
          <dd>{goal.targetDate ? formatCivilDate(goal.targetDate) : "Sem data definida"}</dd>
        </div>
      </dl>
      {children}
    </article>
  );
}

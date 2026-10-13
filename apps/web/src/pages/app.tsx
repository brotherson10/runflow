import { isValidCivilDate, todayInTimeZone } from "@runflow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { GoalForm, WorkoutForm } from "../components/forms.tsx";
import {
  GoalCard,
  PeriodPicker,
  PeriodRange,
  TotalsGrid,
  WorkoutList,
} from "../components/presentation.tsx";
import { useToast } from "../components/Toast.tsx";
import { EmptyState, ErrorState, Field, FormError, Loading, PageTitle, SubmitButton } from "../components/ui.tsx";
import type { AppContext } from "../layouts/app.tsx";
import { errorMessage, type Goal, type Workout, type WorkoutInput } from "../lib/api.ts";
import { authClient, authErrorMessage } from "../lib/auth-client.ts";
import {
  useActiveGoal,
  useCompleteGoal,
  useCreateGoal,
  useCreateWorkout,
  useDashboard,
  useDeleteWorkout,
  useRecentWorkouts,
  useReplaceGoal,
  useUpdateGoal,
  useUpdateWorkout,
  useWorkout,
  useWorkoutHistory,
} from "../lib/data.ts";
import { presetPeriod, type PeriodPreset } from "../lib/dates.ts";
import { formatCivilDate, formatDistance } from "../lib/format.ts";
import { userKeys } from "../lib/query.ts";
import { useSingleFlight } from "../lib/single-flight.ts";
import { useSessionActions } from "../lib/session.ts";

function useApp(): AppContext {
  return useOutletContext<AppContext>();
}

function useToday(): string {
  const { user } = useApp();
  return todayInTimeZone(user.timeZone);
}

export function DashboardPage() {
  const { user } = useApp();
  const today = useToday();
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const period = presetPeriod(preset, today);
  const dashboard = useDashboard(user.id, period.from, period.to);
  const recent = useRecentWorkouts(user.id);

  return (
    <>
      <PageTitle subtitle={`Fuso horário: ${user.timeZone}`}>Olá, {user.name}</PageTitle>
      <div className="toolbar">
        <PeriodPicker value={preset} onChange={setPreset} />
        <Link to="/app/treinos/novo" className="button button-primary">
          Registar treino
        </Link>
      </div>
      <section className="panel" aria-labelledby="resumo">
        <div className="panel-header">
          <h2 id="resumo">Resumo do período</h2>
          <PeriodRange from={period.from} to={period.to} />
        </div>
        {dashboard.isPending ? (
          <Loading />
        ) : dashboard.isError ? (
          <ErrorState message={errorMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />
        ) : (
          <TotalsGrid totals={dashboard.data.totals} />
        )}
      </section>
      <div className="grid-2">
        <section className="panel" aria-labelledby="objetivo-resumo">
          <h2 id="objetivo-resumo">Objetivo</h2>
          {dashboard.data?.activeGoal ? (
            <GoalCard goal={dashboard.data.activeGoal}>
              <Link to="/app/objetivo">Gerir objetivo</Link>
            </GoalCard>
          ) : dashboard.isSuccess ? (
            <EmptyState title="Sem objetivo ativo.">
              <Link to="/app/objetivo" className="button button-secondary">
                Definir objetivo
              </Link>
            </EmptyState>
          ) : null}
        </section>
        <section className="panel" aria-labelledby="recentes">
          <div className="panel-header">
            <h2 id="recentes">Treinos recentes</h2>
            <Link to="/app/treinos">Ver histórico</Link>
          </div>
          {recent.isPending ? (
            <Loading />
          ) : recent.isError ? (
            <ErrorState message={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
          ) : recent.data.items.length === 0 ? (
            <EmptyState title="Ainda não registou treinos.">
              <Link to="/app/treinos/novo">Registar o primeiro treino</Link>
            </EmptyState>
          ) : (
            <WorkoutList items={recent.data.items} />
          )}
        </section>
      </div>
    </>
  );
}

export function WorkoutsPage() {
  const { user } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const rawFrom = params.get("from") ?? "";
  const rawTo = params.get("to") ?? "";
  const from = isValidCivilDate(rawFrom) ? rawFrom : "";
  const to = isValidCivilDate(rawTo) ? rawTo : "";
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [filterError, setFilterError] = useState<string | undefined>();
  const history = useWorkoutHistory(user.id, from, to);
  const remove = useDeleteWorkout(user.id);
  const once = useSingleFlight(remove.isPending);
  const [toDelete, setToDelete] = useState<Workout | null>(null);

  function applyFilters(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftFrom && draftTo && draftFrom > draftTo) {
      setFilterError("A data inicial não pode ser posterior à final.");
      return;
    }
    setFilterError(undefined);
    const next = new URLSearchParams();
    if (draftFrom) next.set("from", draftFrom);
    if (draftTo) next.set("to", draftTo);
    setParams(next);
  }

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageTitle>Treinos</PageTitle>
      <div className="toolbar">
        <Link to="/app/treinos/novo" className="button button-primary">
          Registar treino
        </Link>
      </div>
      <form className="filters" onSubmit={applyFilters} aria-label="Filtrar por período" noValidate>
        <Field label="De" type="date" name="from" value={draftFrom} onChange={(e) => { setDraftFrom(e.target.value); }} error={filterError} />
        <Field label="Até" type="date" name="to" value={draftTo} onChange={(e) => { setDraftTo(e.target.value); }} />
        <div className="filters-actions">
          <button type="submit" className="button button-secondary">
            Filtrar
          </button>
          {(from || to) && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setDraftFrom("");
                setDraftTo("");
                setParams(new URLSearchParams());
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </form>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={from || to ? "Nenhum treino neste período." : "Ainda não registou treinos."} />
      ) : (
        <>
          <WorkoutList
            items={items}
            actions={(workout) => (
              <>
                <Link to={`/app/treinos/${workout.id}/editar`} className="button button-small button-secondary">
                  Editar<span className="visually-hidden"> treino de {formatCivilDate(workout.performedOn)}</span>
                </Link>
                <button type="button" className="button button-small button-ghost-danger" onClick={() => { setToDelete(workout); }}>
                  Eliminar<span className="visually-hidden"> treino de {formatCivilDate(workout.performedOn)}</span>
                </button>
              </>
            )}
          />
          {history.hasNextPage && (
            <button type="button" className="button button-secondary load-more" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
              {history.isFetchingNextPage ? "A carregar…" : "Carregar mais"}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar treino?"
        confirmLabel="Eliminar"
        danger
        pending={remove.isPending}
        onCancel={() => { setToDelete(null); }}
        onConfirm={() => {
          const target = toDelete;
          if (!target) return;
          once(() => {
            remove.mutate(target.id, {
              onSuccess: () => {
                setToDelete(null);
                toast("Treino eliminado.");
              },
              onError: () => {
                setToDelete(null);
              },
            });
          });
        }}
      >
        {toDelete && (
          <p>
            O treino de {formatCivilDate(toDelete.performedOn)} ({formatDistance(toDelete.distanceM)}) será eliminado
            definitivamente.
          </p>
        )}
      </ConfirmDialog>
      {remove.isError && <FormError message={errorMessage(remove.error)} />}
    </>
  );
}

export function WorkoutNewPage() {
  const { user } = useApp();
  const today = useToday();
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateWorkout(user.id);
  return (
    <section className="narrow">
      <PageTitle>Registar treino</PageTitle>
      <WorkoutForm
        today={today}
        timeZone={user.timeZone}
        pending={create.isPending}
        error={create.error}
        submitLabel="Guardar treino"
        onSubmit={(input) => {
          create.mutate(input, {
            onSuccess: () => {
              toast("Treino registado.");
              void navigate("/app/treinos");
            },
          });
        }}
      />
    </section>
  );
}

export function WorkoutEditPage() {
  const { user } = useApp();
  const { id = "" } = useParams();
  const today = useToday();
  const toast = useToast();
  const navigate = useNavigate();
  const workout = useWorkout(user.id, id);
  const update = useUpdateWorkout(user.id, id);

  if (workout.isPending) return <Loading />;
  if (workout.isError) {
    return (
      <section className="narrow">
        <PageTitle>Editar treino</PageTitle>
        <ErrorState message={errorMessage(workout.error)} onRetry={() => void workout.refetch()} />
        <p>
          <Link to="/app/treinos">Voltar aos treinos</Link>
        </p>
      </section>
    );
  }
  const initial: WorkoutInput = workout.data;
  return (
    <section className="narrow">
      <PageTitle>Editar treino</PageTitle>
      <WorkoutForm
        key={workout.data.updatedAt}
        initial={initial}
        today={today}
        timeZone={user.timeZone}
        pending={update.isPending}
        error={update.error}
        submitLabel="Guardar alterações"
        onSubmit={(input) => {
          // Só os campos alterados: a regra de data futura só se aplica se a data mudar.
          const patch: { performedOn?: string; distanceM?: number; durationS?: number; notes?: string | null } = {};
          if (input.performedOn !== initial.performedOn) patch.performedOn = input.performedOn;
          if (input.distanceM !== initial.distanceM) patch.distanceM = input.distanceM;
          if (input.durationS !== initial.durationS) patch.durationS = input.durationS;
          if (input.notes !== initial.notes) patch.notes = input.notes;
          if (Object.keys(patch).length === 0) {
            toast("Sem alterações.");
            void navigate("/app/treinos");
            return;
          }
          update.mutate(patch, {
            onSuccess: () => {
              toast("Treino atualizado.");
              void navigate("/app/treinos");
            },
          });
        }}
      />
    </section>
  );
}

type GoalMode = "view" | "edit" | "replace";

export function GoalPage() {
  const { user } = useApp();
  const today = useToday();
  const toast = useToast();
  const goal = useActiveGoal(user.id);
  const create = useCreateGoal(user.id);
  const update = useUpdateGoal(user.id);
  const complete = useCompleteGoal(user.id);
  const replace = useReplaceGoal(user.id);
  const [mode, setMode] = useState<GoalMode>("view");
  const [confirm, setConfirm] = useState<"complete" | "replace" | null>(null);
  const [pendingReplace, setPendingReplace] = useState<Parameters<typeof replace.mutate>[0] | null>(null);
  const onceComplete = useSingleFlight(complete.isPending);
  const onceReplace = useSingleFlight(replace.isPending);

  if (goal.isPending) return <Loading />;
  if (goal.isError) {
    return (
      <>
        <PageTitle>Objetivo</PageTitle>
        <ErrorState message={errorMessage(goal.error)} onRetry={() => void goal.refetch()} />
      </>
    );
  }

  const active: Goal | null = goal.data;
  return (
    <>
      <PageTitle subtitle="A distância de uma prova que está a preparar.">Objetivo</PageTitle>
      {!active ? (
        <section className="narrow panel">
          <h2>Definir objetivo</h2>
          <GoalForm
            today={today}
            pending={create.isPending}
            error={create.error}
            submitLabel="Criar objetivo"
            onSubmit={(input) => {
              create.mutate(input, { onSuccess: () => { toast("Objetivo criado."); } });
            }}
          />
        </section>
      ) : mode === "view" ? (
        <GoalCard goal={active}>
          {active.targetDate !== null && active.targetDate < today && (
            <p className="notice">A data-alvo já passou. Pode editar o objetivo, concluí-lo ou substituí-lo.</p>
          )}
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={() => { setMode("edit"); }}>
              Editar
            </button>
            <button type="button" className="button button-primary" onClick={() => { setConfirm("complete"); }}>
              Concluir
            </button>
            <button type="button" className="button button-ghost" onClick={() => { setMode("replace"); }}>
              Substituir por outro
            </button>
          </div>
          {complete.isError && <FormError message={errorMessage(complete.error)} />}
        </GoalCard>
      ) : mode === "edit" ? (
        <section className="narrow panel">
          <h2>Editar objetivo</h2>
          <GoalForm
            initial={active}
            today={today}
            pending={update.isPending}
            error={update.error}
            submitLabel="Guardar alterações"
            onCancel={() => { setMode("view"); }}
            onSubmit={(input) => {
              const patch: { title?: string; targetDistanceM?: number; targetDate?: string | null } = {};
              if (input.title !== active.title) patch.title = input.title;
              if (input.targetDistanceM !== active.targetDistanceM) patch.targetDistanceM = input.targetDistanceM;
              if (input.targetDate !== active.targetDate) patch.targetDate = input.targetDate;
              if (Object.keys(patch).length === 0) {
                setMode("view");
                return;
              }
              update.mutate(
                { id: active.id, patch },
                { onSuccess: () => { setMode("view"); toast("Objetivo atualizado."); } },
              );
            }}
          />
        </section>
      ) : (
        <section className="narrow panel">
          <h2>Substituir objetivo</h2>
          <p>O objetivo atual (“{active.title}”) ficará marcado como substituído.</p>
          <GoalForm
            today={today}
            pending={replace.isPending}
            error={replace.error}
            submitLabel="Continuar"
            onCancel={() => { setMode("view"); }}
            onSubmit={(input) => {
              setPendingReplace({ id: active.id, input });
              setConfirm("replace");
            }}
          />
        </section>
      )}

      <ConfirmDialog
        open={confirm === "complete" && active !== null}
        title="Concluir objetivo?"
        confirmLabel="Concluir"
        pending={complete.isPending}
        onCancel={() => { setConfirm(null); }}
        onConfirm={() => {
          if (!active) return;
          onceComplete(() => {
            complete.mutate(active.id, {
              onSettled: () => { setConfirm(null); },
              onSuccess: () => { toast("Objetivo concluído. Parabéns!"); },
            });
          });
        }}
      >
        <p>“{active?.title}” será marcado como concluído. Depois pode definir um novo objetivo.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "replace" && pendingReplace !== null}
        title="Substituir objetivo?"
        confirmLabel="Substituir"
        pending={replace.isPending}
        onCancel={() => { setConfirm(null); }}
        onConfirm={() => {
          const payload = pendingReplace;
          if (!payload) return;
          onceReplace(() => {
            replace.mutate(payload, {
              onSettled: () => { setConfirm(null); },
              onSuccess: () => {
                setMode("view");
                setPendingReplace(null);
                toast("Objetivo substituído.");
              },
            });
          });
        }}
      >
        <p>
          “{active?.title}” passa a substituído e “{pendingReplace?.input.title}” fica como objetivo ativo.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function AccountPage() {
  const { user } = useApp();
  const toast = useToast();
  const client = useQueryClient();
  const { refresh } = useSessionActions();
  const [name, setName] = useState(user.name);
  const [timeZone, setTimeZone] = useState(user.timeZone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = [...Intl.supportedValuesOf("timeZone"), "UTC"];

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { error: updateError } = await authClient.updateUser({ name: name.trim(), timeZone });
    setPending(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    // O fuso muda o "hoje": dados do utilizador voltam a ser pedidos.
    await client.invalidateQueries({ queryKey: userKeys.all(user.id) });
    await refresh();
    toast("Conta atualizada.");
  }

  return (
    <section className="narrow">
      <PageTitle>Conta</PageTitle>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={error} />
        <Field label="Nome" name="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); }} />
        <div className="field">
          <label htmlFor="timeZone">Fuso horário</label>
          <select id="timeZone" name="timeZone" value={timeZone} onChange={(e) => { setTimeZone(e.target.value); }}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="field-hint">Define o que conta como “hoje” nas datas dos treinos.</p>
        </div>
        <p className="field-hint">
          E-mail: <strong>{user.email}</strong>
        </p>
        <SubmitButton pending={pending}>Guardar</SubmitButton>
      </form>
    </section>
  );
}

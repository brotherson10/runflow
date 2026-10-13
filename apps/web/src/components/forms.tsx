/**
 * Formulários de treino e objetivo. Valores convertidos para as unidades da API
 * (metros e segundos inteiros); a validação final é sempre a do servidor.
 * O envio fica bloqueado enquanto um pedido está em curso (sem envio duplicado).
 */
import { LIMITS, codePointLength, isCivilDateInFuture } from "@runflow/shared";
import { useState, type SubmitEvent } from "react";
import { fieldMessage, errorMessage, type GoalInput, type WorkoutInput } from "../lib/api.ts";
import {
  metersToKmInput,
  parseDuration,
  parseKilometers,
  splitDuration,
} from "../lib/format.ts";
import { useSingleFlight } from "../lib/single-flight.ts";
import { Field, FormError, SubmitButton } from "./ui.tsx";

interface WorkoutFormProps {
  readonly initial?: WorkoutInput | undefined;
  readonly today: string;
  readonly timeZone: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly submitLabel: string;
  readonly onSubmit: (input: WorkoutInput) => void;
}

export function WorkoutForm({ initial, today, timeZone, pending, error, submitLabel, onSubmit }: WorkoutFormProps) {
  const duration = initial ? splitDuration(initial.durationS) : { hours: "", minutes: "", seconds: "" };
  const [performedOn, setPerformedOn] = useState(initial?.performedOn ?? today);
  const [km, setKm] = useState(initial ? metersToKmInput(initial.distanceM) : "");
  const [hours, setHours] = useState(duration.hours);
  const [minutes, setMinutes] = useState(duration.minutes);
  const [seconds, setSeconds] = useState(duration.seconds);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [local, setLocal] = useState<Record<string, string>>({});
  const once = useSingleFlight(pending);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors: Record<string, string> = {};
    const distanceM = parseKilometers(km);
    const durationS = parseDuration(hours, minutes, seconds);
    if (!performedOn) errors["performedOn"] = "Indique a data do treino.";
    else if (isCivilDateInFuture(performedOn, { timeZone })) errors["performedOn"] = "A data não pode ser futura.";
    if (distanceM === null || distanceM > LIMITS.distanceM.max) errors["distanceM"] = "Indique uma distância válida em km (ex.: 10,5).";
    if (durationS === null || durationS > LIMITS.durationS.max) errors["durationS"] = "Indique uma duração válida (minutos e segundos até 59).";
    if (codePointLength(notes.trim()) > LIMITS.notesMaxLength) errors["notes"] = `Máximo de ${String(LIMITS.notesMaxLength)} caracteres.`;
    setLocal(errors);
    if (Object.keys(errors).length > 0 || distanceM === null || durationS === null) return;
    once(() => {
      onSubmit({ performedOn, distanceM, durationS, notes: notes.trim() === "" ? null : notes.trim() });
    });
  }

  const err = (field: string) => local[field] ?? fieldMessage(error, field);
  const general = error && !["performedOn", "distanceM", "durationS", "notes"].some((f) => fieldMessage(error, f))
    ? errorMessage(error)
    : null;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <FormError message={general} />
      <Field
        label="Data"
        type="date"
        name="performedOn"
        value={performedOn}
        max={today}
        required
        onChange={(event) => {
          setPerformedOn(event.target.value);
        }}
        error={err("performedOn")}
      />
      <Field
        label="Distância (km)"
        name="distanceKm"
        inputMode="decimal"
        autoComplete="off"
        placeholder="10,5"
        value={km}
        required
        onChange={(event) => {
          setKm(event.target.value);
        }}
        error={err("distanceM")}
      />
      <fieldset className="duration" aria-describedby={err("durationS") ? "duration-error" : undefined}>
        <legend>Duração</legend>
        <div className="duration-inputs">
          <Field label="Horas" name="hours" inputMode="numeric" value={hours} onChange={(e) => { setHours(e.target.value); }} />
          <Field label="Minutos" name="minutes" inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value); }} />
          <Field label="Segundos" name="seconds" inputMode="numeric" value={seconds} onChange={(e) => { setSeconds(e.target.value); }} />
        </div>
        {err("durationS") && (
          <p className="field-error" id="duration-error">
            {err("durationS")}
          </p>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="notes">Observações (opcional)</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={LIMITS.notesMaxLength * 2}
          value={notes}
          aria-invalid={err("notes") ? true : undefined}
          aria-describedby={err("notes") ? "notes-error" : undefined}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
        {err("notes") && (
          <p className="field-error" id="notes-error">
            {err("notes")}
          </p>
        )}
      </div>
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}

interface GoalFormProps {
  readonly initial?: GoalInput | undefined;
  readonly today: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly submitLabel: string;
  readonly onSubmit: (input: GoalInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

export function GoalForm({ initial, today, pending, error, submitLabel, onSubmit, onCancel }: GoalFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [km, setKm] = useState(initial ? metersToKmInput(initial.targetDistanceM) : "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [local, setLocal] = useState<Record<string, string>>({});
  const once = useSingleFlight(pending);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors: Record<string, string> = {};
    const distance = parseKilometers(km);
    if (title.trim() === "" || codePointLength(title.trim()) > LIMITS.goalTitleLength.max) errors["title"] = "Indique um título (até 80 caracteres).";
    if (distance === null || distance > LIMITS.distanceM.max) errors["targetDistanceM"] = "Indique a distância da prova em km.";
    if (targetDate !== "" && targetDate < today && targetDate !== initial?.targetDate) errors["targetDate"] = "A data-alvo não pode ser anterior a hoje.";
    setLocal(errors);
    if (Object.keys(errors).length > 0 || distance === null) return;
    once(() => {
      onSubmit({ title: title.trim(), targetDistanceM: distance, targetDate: targetDate === "" ? null : targetDate });
    });
  }

  const err = (field: string) => local[field] ?? fieldMessage(error, field);
  const general = error && !["title", "targetDistanceM", "targetDate"].some((f) => fieldMessage(error, f))
    ? errorMessage(error)
    : null;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <FormError message={general} />
      <Field label="Título" name="title" value={title} maxLength={160} required placeholder="Meia maratona de Lisboa" onChange={(e) => { setTitle(e.target.value); }} error={err("title")} />
      <Field label="Distância da prova (km)" name="targetKm" inputMode="decimal" value={km} required placeholder="21,1" onChange={(e) => { setKm(e.target.value); }} error={err("targetDistanceM")} />
      <Field label="Data-alvo (opcional)" type="date" name="targetDate" value={targetDate} min={today} onChange={(e) => { setTargetDate(e.target.value); }} error={err("targetDate")} />
      <div className="form-actions">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        {onCancel && (
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={pending}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

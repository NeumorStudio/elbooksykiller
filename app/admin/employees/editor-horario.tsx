"use client";

import { useId, useState } from "react";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";

export type Modo = "continua" | "partida" | "cerrado";
export type HorasIniciales = {
  inicio: string; fin: string;
  mInicio: string; mFin: string; tInicio: string; tFin: string;
};

const DIAS: [number, string, string][] = [
  [1, "L", "lunes"], [2, "M", "martes"], [3, "X", "miércoles"],
  [4, "J", "jueves"], [5, "V", "viernes"], [6, "S", "sábado"], [0, "D", "domingo"],
];

/**
 * Editor de horario de una persona, por tandas de días.
 *
 * La unidad de edición es "estos días trabajan así", no "este tramo suelto":
 * es como lo dice un peluquero y evita el estado intermedio en el que
 * alguien se queda sin horario mientras lo rehace. Guardar sustituye lo que
 * hubiera en los días marcados y no toca el resto, así que el caso normal
 * (lunes a viernes de una forma, sábado de otra) son dos pasadas.
 */
export default function EditorHorario({
  action,
  employeeId,
  nombre,
  diasIniciales,
  modoInicial,
  horasIniciales,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  employeeId: string;
  nombre: string;
  diasIniciales: number[];
  modoInicial: Modo;
  horasIniciales: HorasIniciales;
}) {
  const [modo, setModo] = useState<Modo>(modoInicial);
  const uid = useId();
  const h = horasIniciales;

  const opcion = (valor: Modo, etiqueta: string) => (
    <label
      key={valor}
      className="flex items-center gap-2.5 cursor-pointer min-h-11 select-none"
    >
      <input
        type="radio"
        name="modo"
        value={valor}
        checked={modo === valor}
        onChange={() => setModo(valor)}
        className="h-4 w-4 accent-[var(--brand)]"
      />
      <span className={modo === valor ? "font-medium" : "text-muted"}>{etiqueta}</span>
    </label>
  );

  const hora = (name: string, etiqueta: string, valor: string) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="label">{etiqueta}</label>
      <input
        id={`${uid}-${name}`}
        name={name}
        type="time"
        required
        defaultValue={valor}
        step={300}
        className="field w-28"
      />
    </div>
  );

  return (
    <ActionForm action={action} className="flex flex-col gap-4 pt-2">
      <input type="hidden" name="employee_id" value={employeeId} />

      <fieldset>
        <legend className="label">Días que se guardan</legend>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map(([d, corta, larga]) => (
            <label
              key={d}
              className="chip w-11 justify-center has-[:checked]:border-brand
                has-[:checked]:bg-brand has-[:checked]:text-brand-ink has-[:checked]:font-semibold"
            >
              <input
                type="checkbox"
                name="weekday"
                value={d}
                defaultChecked={diasIniciales.includes(d)}
                className="sr-only"
              />
              <span aria-hidden>{corta}</span>
              <span className="sr-only">{`${larga} de ${nombre}`}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted mt-1.5 text-pretty">
          Los días que no marques se quedan como están.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="label">Cómo trabaja esos días</legend>

        {opcion("continua", "Jornada continua")}
        {modo === "continua" && (
          <div className="flex flex-wrap gap-2 pl-7 pb-1">
            {hora("inicio", "Abre", h.inicio)}
            {hora("fin", "Cierra", h.fin)}
          </div>
        )}

        {opcion("partida", "Jornada partida")}
        {modo === "partida" && (
          <div className="flex flex-col gap-2 pl-7 pb-1">
            <div className="flex flex-wrap gap-2 items-end">
              <span className="label w-16 mb-2.5">Mañana</span>
              {hora("m_inicio", "De", h.mInicio)}
              {hora("m_fin", "A", h.mFin)}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <span className="label w-16 mb-2.5">Tarde</span>
              {hora("t_inicio", "De", h.tInicio)}
              {hora("t_fin", "A", h.tFin)}
            </div>
          </div>
        )}

        {opcion("cerrado", "No trabaja esos días")}
      </fieldset>

      <SubmitButton className="btn-primary self-start" pendingText="Guardando…">
        Guardar horario
      </SubmitButton>
    </ActionForm>
  );
}

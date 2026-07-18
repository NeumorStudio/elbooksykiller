import { supabaseServer } from "@/lib/supabase/server";
import {
  addEmployee, deactivateEmployee, addHours, deleteHours, addTimeOff, deleteTimeOff,
} from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";

type WH = { id: string; weekday: number; start_min: number; end_min: number };
type TO = { id: string; starts_at: string; ends_at: string; reason: string | null };

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const fmtMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function EmployeesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, timezone, employees(*, working_hours(*), time_off(*))")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const employees = salon.employees.filter((e) => e.active);

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Equipo y horarios</h1>
        <p className="text-muted mt-1">
          Quién trabaja y cuándo. Los huecos de reserva salen de aquí.
        </p>
      </div>

      {employees.length === 0 && (
        <div className="panel p-8 text-center text-muted">
          <p className="font-medium text-ink">Aún no hay nadie en el equipo</p>
          <p className="mt-1 text-pretty">
            Añade al menos un profesional (aunque seas solo tú) y su horario semanal.
          </p>
        </div>
      )}

      {employees.map((emp) => {
        const hours = (emp.working_hours as WH[]).sort(
          (a, b) => a.weekday - b.weekday || a.start_min - b.start_min
        );
        return (
          <section key={emp.id} className="panel p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{emp.name}</h2>
              <form action={deactivateEmployee}>
                <input type="hidden" name="id" value={emp.id} />
                <ConfirmSubmit message={`¿Dar de baja a ${emp.name}? Dejará de aparecer en la web de reservas.`}>
                  Dar de baja
                </ConfirmSubmit>
              </form>
            </div>

            {hours.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {hours.map((h) => (
                  <li key={h.id} className="flex items-center gap-3">
                    <span className="w-24 text-muted">{DAYS[h.weekday]}</span>
                    <span className="tabular-nums font-medium">
                      {fmtMin(h.start_min)} – {fmtMin(h.end_min)}
                    </span>
                    <form action={deleteHours}>
                      <input type="hidden" name="id" value={h.id} />
                      <ConfirmSubmit
                        message={`¿Quitar el tramo de ${DAYS[h.weekday]}?`}
                        className="text-danger hover:bg-danger/10 rounded-lg min-h-11 min-w-11 text-lg"
                        aria-label={`Quitar tramo de ${DAYS[h.weekday]}`}
                      >
                        ×
                      </ConfirmSubmit>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-danger/90">
                Sin horario: no aparecerá en la web de reservas.
              </p>
            )}

            {(() => {
              const offs = (emp.time_off as TO[])
                .filter((t) => new Date(t.ends_at) > new Date())
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const fmtDay = (iso: string) =>
                new Date(iso).toLocaleDateString("es-ES", {
                  day: "numeric", month: "short", timeZone: salon.timezone,
                });
              // ends_at es exclusivo: el último día real es el anterior
              const lastDay = (iso: string) =>
                fmtDay(new Date(new Date(iso).getTime() - 86400000).toISOString());
              return offs.length > 0 ? (
                <div className="border-t border-line pt-3">
                  <p className="label">Ausencias próximas</p>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {offs.map((t) => (
                      <li key={t.id} className="flex items-center gap-3">
                        <span className="tabular-nums">
                          {fmtDay(t.starts_at)}
                          {lastDay(t.ends_at) !== fmtDay(t.starts_at) && ` – ${lastDay(t.ends_at)}`}
                        </span>
                        {t.reason && <span className="text-muted">{t.reason}</span>}
                        <form action={deleteTimeOff}>
                          <input type="hidden" name="id" value={t.id} />
                          <ConfirmSubmit
                            message="¿Quitar esta ausencia? Los huecos volverán a ofrecerse."
                            className="text-danger hover:bg-danger/10 rounded-lg min-h-11 min-w-11 text-lg"
                            aria-label="Quitar ausencia"
                          >
                            ×
                          </ConfirmSubmit>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            <details className="border-t border-line pt-3 group">
              <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink py-2 select-none">
                + Bloquear vacaciones o ausencias
              </summary>
              <ActionForm
                action={addTimeOff}
                className="flex flex-wrap gap-2 items-end pt-2"
              >
                <input type="hidden" name="employee_id" value={emp.id} />
                <div>
                  <label htmlFor={`tf-${emp.id}`} className="label">Ausente desde</label>
                  <input id={`tf-${emp.id}`} name="from" type="date" required className="field w-40" />
                </div>
                <div>
                  <label htmlFor={`tt-${emp.id}`} className="label">Hasta (incluido)</label>
                  <input id={`tt-${emp.id}`} name="to" type="date" className="field w-40" />
                </div>
                <div className="flex-1 min-w-36">
                  <label htmlFor={`tr-${emp.id}`} className="label">Motivo (opcional)</label>
                  <input id={`tr-${emp.id}`} name="reason" placeholder="Vacaciones" className="field" />
                </div>
                <SubmitButton className="btn-quiet" pendingText="Bloqueando…">Bloquear días</SubmitButton>
              </ActionForm>
            </details>

            <details className="border-t border-line pt-3 group" open={hours.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink py-2 select-none">
                + Añadir tramo de horario
              </summary>
              <ActionForm action={addHours} className="flex flex-col gap-3 pt-2">
                <input type="hidden" name="employee_id" value={emp.id} />
                <div>
                  <span className="label">Días (elige varios)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <label
                        key={d}
                        className="chip px-3 has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-brand-ink has-[:checked]:font-semibold"
                      >
                        <input
                          type="checkbox"
                          name="weekday"
                          value={d}
                          defaultChecked={d >= 1 && d <= 5 && hours.length === 0}
                          className="sr-only"
                        />
                        {DAYS[d].slice(0, 3)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label htmlFor={`st-${emp.id}`} className="label">De</label>
                    <input id={`st-${emp.id}`} name="start" type="time" required defaultValue="10:00" className="field w-28" />
                  </div>
                  <div>
                    <label htmlFor={`en-${emp.id}`} className="label">A</label>
                    <input id={`en-${emp.id}`} name="end" type="time" required defaultValue="20:00" className="field w-28" />
                  </div>
                  <SubmitButton className="btn-quiet" pendingText="Añadiendo…">Añadir tramo</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </section>
        );
      })}

      <ActionForm action={addEmployee} className="panel p-5">
        <h2 className="font-semibold mb-4">Añadir profesional</h2>
        <input type="hidden" name="salon_id" value={salon.id} />
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-48">
            <label htmlFor="emp-name" className="label">Nombre</label>
            <input id="emp-name" name="name" required placeholder="Paco" className="field" />
          </div>
          <SubmitButton className="btn-primary" pendingText="Añadiendo…">Añadir</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}

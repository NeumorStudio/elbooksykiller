import { supabaseServer } from "@/lib/supabase/server";
import {
  addEmployee, deactivateEmployee, reactivarEmpleado, guardarHorario,
  copiarHorario, addTimeOff, deleteTimeOff, cerrarDia,
} from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";
import EditorHorario from "./editor-horario";
import {
  agruparHorario, diasCerrados, diasConSolape, estadoInicial, fmtMin, resumenDias,
  type Tramo,
} from "./horario";

type TO = { id: string; starts_at: string; ends_at: string; reason: string | null };
type Emp = {
  id: string; name: string; active: boolean;
  working_hours: Tramo[]; time_off: TO[];
};

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

  const todos = (salon.employees as unknown as Emp[]).sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );
  const equipo = todos.filter((e) => e.active);
  const deBaja = todos.filter((e) => !e.active);
  // Solo tiene sentido copiar de quien ya tiene algo que copiar.
  const conHorario = equipo.filter((e) => e.working_hours.length > 0);

  const fmtDia = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric", month: "short", timeZone: salon.timezone,
    });
  // ends_at es exclusivo: el último día real es el anterior
  const ultimoDia = (iso: string) =>
    fmtDia(new Date(new Date(iso).getTime() - 86400000).toISOString());

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Equipo y horarios</h1>
        <p className="text-muted mt-1">
          Quién trabaja y cuándo. Los huecos de reserva salen de aquí.
        </p>
      </div>

      {equipo.length === 0 && (
        <div className="panel p-8 text-center text-muted">
          <p className="font-medium text-ink">Aún no hay nadie en el equipo</p>
          <p className="mt-1 text-pretty">
            Añade al menos a una persona —aunque seas tú— y su horario semanal.
          </p>
        </div>
      )}

      {equipo.map((emp) => {
        const grupos = agruparHorario(emp.working_hours);
        const cerrados = diasCerrados(emp.working_hours);
        const solapes = diasConSolape(emp.working_hours);
        const inicial = estadoInicial(emp.working_hours);
        const offs = emp.time_off
          .filter((t) => new Date(t.ends_at) > new Date())
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

        return (
          <section key={emp.id} className="panel p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{emp.name}</h2>
              <form action={deactivateEmployee}>
                <input type="hidden" name="id" value={emp.id} />
                <ConfirmSubmit
                  message={`¿Dar de baja a ${emp.name}? Dejará de aparecer en la web de reservas. Podrás recuperarlo cuando quieras.`}
                >
                  Dar de baja
                </ConfirmSubmit>
              </form>
            </div>

            {/* ── Horario, leído de un vistazo ────────────────────────── */}
            {grupos.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {grupos.map((g) => (
                  <li key={g.dias.join()} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="w-20 shrink-0 text-muted">{resumenDias(g.dias)}</span>
                    <span className="tabular-nums font-medium">
                      {g.tramos.map(([a, b]) => `${fmtMin(a)}–${fmtMin(b)}`).join("  ·  ")}
                    </span>
                  </li>
                ))}
                {cerrados.length > 0 && (
                  <li className="flex flex-wrap items-baseline gap-x-3 text-muted">
                    <span className="w-20 shrink-0">{resumenDias(cerrados)}</span>
                    <span>no trabaja</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-danger/90">
                Sin horario: no aparece en la web de reservas y nadie puede pedirle cita.
              </p>
            )}

            {solapes.length > 0 && (
              <p className="rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm text-pretty">
                <b>Horas solapadas</b> en {resumenDias(solapes).toLowerCase()}: hay
                tramos que se pisan. Vuelve a guardar esos días para dejarlo limpio.
              </p>
            )}

            <details className="border-t border-line pt-3" open={grupos.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink py-2 select-none">
                {grupos.length === 0 ? "Poner horario" : "Editar horario"}
              </summary>
              <EditorHorario
                action={guardarHorario}
                employeeId={emp.id}
                nombre={emp.name}
                diasIniciales={inicial.dias}
                modoInicial={inicial.modo}
                horasIniciales={inicial.horas}
              />
            </details>

            {/* Copiar solo se ofrece cuando ahorra trabajo de verdad: a quien
                aún no tiene horario y hay de quién copiarlo. */}
            {grupos.length === 0 && conHorario.length > 0 && (
              <ActionForm action={copiarHorario} className="flex flex-wrap gap-2 items-end">
                <input type="hidden" name="destino" value={emp.id} />
                <div className="flex-1 min-w-48">
                  <label htmlFor={`cp-${emp.id}`} className="label">
                    O copiar el horario de un compañero
                  </label>
                  <select id={`cp-${emp.id}`} name="origen" className="field" defaultValue="">
                    <option value="" disabled>Elige a quién copiar…</option>
                    {conHorario.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <SubmitButton className="btn-quiet" pendingText="Copiando…">Copiar</SubmitButton>
              </ActionForm>
            )}

            {offs.length > 0 && (
              <div className="border-t border-line pt-3">
                <p className="label">Ausencias próximas</p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {offs.map((t) => (
                    <li key={t.id} className="flex items-center gap-3">
                      <span className="tabular-nums">
                        {fmtDia(t.starts_at)}
                        {ultimoDia(t.ends_at) !== fmtDia(t.starts_at) &&
                          ` – ${ultimoDia(t.ends_at)}`}
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
            )}

            <details className="border-t border-line pt-3">
              <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink py-2 select-none">
                Bloquear vacaciones o ausencias
              </summary>
              <ActionForm action={addTimeOff} className="flex flex-wrap gap-2 items-end pt-2">
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
        <p className="text-xs text-muted mt-2 text-pretty">
          Añádete también a ti si atiendes: los clientes solo pueden reservar
          con quien aparece aquí.
        </p>
      </ActionForm>

      {/* ── Cerrar el salón un día suelto ──────────────────────────── */}
      {equipo.length > 0 && (
        <ActionForm action={cerrarDia} className="panel p-5">
          <h2 className="font-semibold">Cerrar un día</h2>
          <p className="text-sm text-muted mt-1 mb-4 text-pretty">
            Un festivo, una mudanza, lo que sea. Bloquea el día entero para todo
            el equipo: ese día no se puede reservar.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label htmlFor="cd-dia" className="label">Día</label>
              <input id="cd-dia" name="dia" type="date" required className="field w-40" />
            </div>
            <div className="flex-1 min-w-36">
              <label htmlFor="cd-motivo" className="label">Motivo (opcional)</label>
              <input id="cd-motivo" name="motivo" placeholder="Festivo local" className="field" />
            </div>
            <SubmitButton className="btn-quiet" pendingText="Cerrando…">Cerrar ese día</SubmitButton>
          </div>
        </ActionForm>
      )}

      {/* ── Dados de baja ──────────────────────────────────────────── */}
      {deBaja.length > 0 && (
        <section>
          <h2 className="font-semibold mb-1">Dados de baja</h2>
          <p className="text-sm text-muted mb-3 text-pretty">
            No aparecen en la web. Su historial de citas se conserva, así que
            recuperarlos no pierde nada.
          </p>
          <ul className="tarjeta divide-y divide-line-subtle overflow-hidden">
            {deBaja.map((e) => (
              <li key={e.id} className="flex items-center gap-4 p-4">
                <span className="flex-1 min-w-0 truncate text-muted">{e.name}</span>
                <form action={reactivarEmpleado}>
                  <input type="hidden" name="id" value={e.id} />
                  <SubmitButton className="btn-quiet text-sm" pendingText="Recuperando…">
                    Recuperar
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

import { supabaseServer } from "@/lib/supabase/server";
import {
  addEmployee, deactivateEmployee, reactivarEmpleado, guardarHorario,
  copiarHorario, addTimeOff, deleteTimeOff, cerrarDia,
} from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";
import Ayuda from "../ayuda";
import EditorHorario from "./editor-horario";
import {
  darAcceso, reenviarAcceso, quitarAcceso, renombrarEmpleado, guardarPermisos,
  subirFotoEmpleado, quitarFotoEmpleado,
} from "./acceso-actions";
import { features } from "@/lib/features";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fotosDelEquipo } from "@/lib/fotos-equipo";
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
  const fotos = await fotosDelEquipo(salon.id);

  // Quién del equipo entra con su propia cuenta (0033). Con la migración sin
  // aplicar, ni se pregunta: pedir la tabla tumbaría la consulta.
  type Acceso = {
    employee_id: string; email: string; last_invited_at: string | null; user_id: string;
    created_at: string; ver_agenda_equipo?: boolean; apuntar_citas?: boolean;
  };
  const accesos = new Map<string, Acceso & { activo: boolean }>();
  const f = await features();
  if (f.trabajadores) {
    const { data } = await supabase
      .from("employee_access")
      .select(
        "employee_id, email, last_invited_at, user_id, created_at" +
          // Las columnas de la 0034: sin ella, pedirlas tumbaría la consulta.
          (f.permisos_equipo ? ", ver_agenda_equipo, apuntar_citas" : "")
      )
      .in("employee_id", equipo.map((e) => e.id));
    // «Ya ha entrado» sale de Auth, que solo se lee con service role. Son
    // dos o tres personas por salón: una llamada por cabeza es poca cosa.
    const admin = supabaseAdmin();
    for (const a of (data as unknown as Acceso[] | null) ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(a.user_id);
      // Solo cuenta una entrada POSTERIOR a darle el acceso. Quien ya era
      // cliente con cuenta (entró alguna vez a su perfil) traía una fecha
      // de entrada de antes, y salía «ya ha entrado» sin haber abierto el
      // enlace. Le pasó al primer trabajador del piloto.
      const entro = u?.user?.last_sign_in_at;
      accesos.set(a.employee_id, {
        ...a,
        activo: !!entro && Date.parse(entro) >= Date.parse(a.created_at),
      });
    }
  }
  const conAccesos = f.trabajadores;
  const conPermisos = f.permisos_equipo;

  const fmtDia = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric", month: "short", timeZone: salon.timezone,
    });
  // ends_at es exclusivo: el último día real es el anterior
  const ultimoDia = (iso: string) =>
    fmtDia(new Date(new Date(iso).getTime() - 86400000).toISOString());

  return (
    <main className="flex flex-col gap-8 max-w-2xl mx-auto">
      <div>
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Equipo y horarios</h1>
          <Ayuda titulo="Equipo y horarios">
            <p>
              Añade a cada persona que atiende en tu salón — aunque trabajes
              solo, añádete a ti. Tus clientes eligen con quién reservar.
            </p>
            <p>
              <b>El horario es lo importante:</b> los huecos que se ofrecen en
              tu web salen de aquí, y quien no tiene horario no aparece.
            </p>
            <p>
              En «Editar horario» marcas <b>los días</b> y luego dices cómo se
              trabaja esos días: <b>jornada continua</b> (de 10:00 a 20:00),{" "}
              <b>jornada partida</b> si paras a mediodía —mañana y tarde, y
              nadie te reserva en el descanso—, o <b>no trabaja</b>.
            </p>
            <p>
              Guardar cambia <b>solo los días que has marcado</b>; el resto se
              queda como estaba. Por eso lo normal son dos pasadas: una para
              lunes a viernes y otra para el sábado.
            </p>
            <p>
              A quien acabas de dar de alta puedes <b>copiarle el horario</b>{" "}
              de un compañero y ajustarlo después.
            </p>
            <p>
              <b>La foto</b> sale en tu web cuando el cliente elige con quién
              reservar, en lugar de la inicial. Una de cara y con buena luz:
              se ve en pequeño, dentro de un círculo.
            </p>
            <p>
              <b>«Bloquear vacaciones o ausencias»</b> quita esos días de la
              web para una persona: viajes, médico… Al volver, se quita con la
              ✕. <b>«Cerrar un día»</b> hace lo mismo para todo el equipo de
              golpe — un festivo local, una mudanza.
            </p>
            <p>
              <b>«Dar de baja»</b> es para cuando alguien deja el salón: sus
              citas pasadas se conservan y ya no se le puede reservar. No es
              definitivo, aparece abajo y puedes recuperarlo cuando vuelva.
            </p>
          </Ayuda>
        </span>
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
              <div className="flex items-center gap-3 min-w-0">
                {/* Como lo ve el cliente en la web: foto o, si no hay, la inicial. */}
                {fotos[emp.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fotos[emp.id]}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-xl text-brand"
                  >
                    {emp.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <h2 className="text-lg font-semibold truncate">{emp.name}</h2>
              </div>
              <form action={deactivateEmployee}>
                <input type="hidden" name="id" value={emp.id} />
                <ConfirmSubmit
                  message={`¿Dar de baja a ${emp.name}? Dejará de aparecer en la web de reservas. Podrás recuperarlo cuando quieras.`}
                >
                  Dar de baja
                </ConfirmSubmit>
              </form>
            </div>

            <details className="text-sm -mt-2">
              <summary className="cursor-pointer text-muted hover:text-ink w-fit">Cambiar nombre</summary>
              <ActionForm action={renombrarEmpleado} className="flex gap-2 items-end mt-3 flex-wrap">
                <input type="hidden" name="employee_id" value={emp.id} />
                <div className="flex-1 min-w-48">
                  <label htmlFor={`nm-${emp.id}`} className="label">Nombre en la web de reservas</label>
                  <input
                    id={`nm-${emp.id}`}
                    name="name"
                    required
                    minLength={2}
                    maxLength={60}
                    defaultValue={emp.name}
                    className="field"
                  />
                </div>
                <SubmitButton className="btn-quiet" pendingText="Guardando…">Guardar</SubmitButton>
              </ActionForm>
            </details>

            <details className="text-sm -mt-2">
              <summary className="cursor-pointer text-muted hover:text-ink w-fit">
                {fotos[emp.id] ? "Cambiar foto" : "Poner foto"}
              </summary>
              <div className="flex flex-col gap-2 mt-3">
                <ActionForm action={subirFotoEmpleado} className="flex gap-2 items-end flex-wrap">
                  <input type="hidden" name="employee_id" value={emp.id} />
                  <div className="flex-1 min-w-48">
                    <label htmlFor={`ft-${emp.id}`} className="label">Foto en la web de reservas</label>
                    <input
                      id={`ft-${emp.id}`}
                      name="foto"
                      type="file"
                      required
                      accept="image/png,image/jpeg,image/webp"
                      className="field pt-2"
                    />
                  </div>
                  <SubmitButton className="btn-quiet" pendingText="Subiendo…">Guardar foto</SubmitButton>
                </ActionForm>
                <p className="text-xs text-muted text-pretty">
                  Sale cuando el cliente elige con quién reservar. Mejor de cara y
                  con luz. PNG, JPG o WebP, hasta 3 MB.
                </p>
                {fotos[emp.id] && (
                  <ActionForm action={quitarFotoEmpleado}>
                    <input type="hidden" name="employee_id" value={emp.id} />
                    <ConfirmSubmit
                      className="btn-quiet text-danger"
                      message={`¿Quitar la foto de ${emp.name}? En la web volverá a salir su inicial.`}
                    >
                      Quitar foto
                    </ConfirmSubmit>
                  </ActionForm>
                )}
              </div>
            </details>

            {/* ── Acceso a su agenda desde el móvil (0033) ─────────────── */}
            {conAccesos && (() => {
              const a = accesos.get(emp.id);
              if (!a) {
                return (
                  <ActionForm action={darAcceso} className="rounded-lg border border-line p-4 flex flex-col gap-3">
                    <input type="hidden" name="employee_id" value={emp.id} />
                    <div>
                      <p className="font-medium">Acceso desde su móvil</p>
                      <p className="text-sm text-muted text-pretty mt-1">
                        Verá sus citas y podrá marcar si el cliente vino.
                        {conPermisos
                          ? " Después podrás dejarle ver la agenda de todos o apuntar citas. La caja, los clientes y los precios siguen siendo solo tuyos."
                          : " No verá la caja, ni a los clientes, ni las citas de los demás."}
                      </p>
                    </div>
                    <div className="flex gap-2 items-end flex-wrap">
                      <div className="flex-1 min-w-48">
                        <label htmlFor={`ac-${emp.id}`} className="label">Su correo</label>
                        <input
                          id={`ac-${emp.id}`}
                          name="email"
                          type="email"
                          required
                          autoComplete="off"
                          placeholder="nombre@gmail.com"
                          className="field"
                        />
                      </div>
                      <SubmitButton className="btn-quiet" pendingText="Enviando…">Darle acceso</SubmitButton>
                    </div>
                    <p className="text-xs text-muted text-pretty">
                      Le llega un correo para elegir su contraseña. Tú no la ves nunca.
                    </p>
                  </ActionForm>
                );
              }
              return (
                <div className="rounded-lg border border-line p-4 flex flex-col gap-3">
                  <div>
                    <p className="font-medium">
                      Entra desde su móvil{" "}
                      <span className={a.activo ? "text-ok" : "text-muted"}>
                        · {a.activo ? "ya ha entrado" : "pendiente de activar"}
                      </span>
                    </p>
                    <p className="text-sm text-muted mt-1 break-all">{a.email}</p>
                    {!a.activo && a.last_invited_at && (
                      <p className="text-xs text-muted mt-1">
                        Enlace enviado el {fmtDia(a.last_invited_at)}. Caduca a la hora: si no
                        le dio tiempo, reenvíaselo.
                      </p>
                    )}
                  </div>
                  {/* ── Qué puede hacer (0034) ───────────────────────────
                      La `key` remonta el formulario cuando cambian los
                      valores guardados: si no, las casillas se quedarían
                      como las dejó el navegador y no como están. */}
                  {conPermisos && (
                    <ActionForm
                      key={`${a.ver_agenda_equipo}-${a.apuntar_citas}`}
                      action={guardarPermisos}
                      className="flex flex-col gap-3 border-t border-line pt-3"
                    >
                      <input type="hidden" name="employee_id" value={emp.id} />
                      <p className="label">Qué puede hacer</p>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          name="ver_agenda_equipo"
                          defaultChecked={!!a.ver_agenda_equipo}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                        />
                        <span>
                          <span className="font-medium">Ver la agenda de todo el equipo</span>
                          <span className="block text-sm text-muted text-pretty">
                            Las citas de los demás, para saber qué huecos quedan.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          name="apuntar_citas"
                          defaultChecked={!!a.apuntar_citas}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                        />
                        <span>
                          <span className="font-medium">Apuntar, mover y cancelar citas</span>
                          <span className="block text-sm text-muted text-pretty">
                            Las suyas, o las de todos si también ve la agenda del equipo.
                            Las pagadas online solo las cancelas tú.
                          </span>
                        </span>
                      </label>
                      <SubmitButton className="btn-quiet self-start" pendingText="Guardando…">
                        Guardar permisos
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <ActionForm action={reenviarAcceso}>
                      <input type="hidden" name="employee_id" value={emp.id} />
                      <SubmitButton className="btn-quiet" pendingText="Enviando…">
                        {a.activo ? "Mandarle enlace para cambiar contraseña" : "Reenviar enlace"}
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={quitarAcceso}>
                      <input type="hidden" name="employee_id" value={emp.id} />
                      <ConfirmSubmit
                        className="btn-quiet text-danger"
                        message={`¿Quitarle el acceso a ${emp.name}? Dejará de poder entrar. Sus citas no se tocan.`}
                      >
                        Quitar acceso
                      </ConfirmSubmit>
                    </ActionForm>
                  </div>
                </div>
              );
            })()}

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

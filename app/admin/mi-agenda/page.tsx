import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { miPuesto } from "@/lib/puesto";
import { zonedMidnightUtc } from "@/lib/tz";
import { telHref, normalizarTel } from "@/lib/tel";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";
import SubmitButton from "../submit-button";
import { marcarMiCita } from "./actions";

/**
 * La agenda del trabajador: sus citas de hoy y de las dos semanas que
 * vienen, y los botones para marcar si el cliente vino.
 *
 * Todo sale de la RPC `mis_citas` (0033), que ya filtra por su ficha y solo
 * trae lo que hace falta en la silla. Aquí no hay caja, ni compañeros, ni
 * fichas de cliente: eso sigue siendo del dueño.
 */

type Cita = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  notes: string | null;
  service_name: string | null;
};

const DIAS = 14;

function diaLocal(iso: string | Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

function masDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function MiAgenda() {
  const puesto = await miPuesto();
  // Un dueño (o cualquiera sin puesto) no pinta nada aquí: a su agenda.
  if (!puesto) redirect("/admin");

  const nombre = puesto.employee_name.split(" ")[0] || puesto.employee_name;

  if (!puesto.active) {
    return (
      <main className="mx-auto max-w-md pt-8">
        <h1 className="font-display text-3xl font-semibold">Hola, {nombre}</h1>
        <div className="panel p-6 mt-6 text-pretty">
          Tu ficha en {puesto.salon_name} está dada de baja, así que ahora mismo no
          tienes citas. Si es un error, díselo en el salón.
        </div>
      </main>
    );
  }

  const tz = puesto.timezone;
  const ahora = new Date();
  const hoy = diaLocal(ahora, tz);
  const manana = masDias(hoy, 1);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("mis_citas", {
    p_desde: zonedMidnightUtc(hoy, tz),
    p_hasta: zonedMidnightUtc(masDias(hoy, DIAS), tz),
  });
  if (error) console.error("mis_citas:", error.message);
  const citas = (data as Cita[] | null) ?? [];

  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const fechaLarga = (dia: string) =>
    new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-ES", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });

  // Agrupadas por día local del salón, en orden.
  const porDia = new Map<string, Cita[]>();
  for (const c of citas) {
    const k = diaLocal(c.starts_at, tz);
    porDia.set(k, [...(porDia.get(k) ?? []), c]);
  }

  const deHoy = porDia.get(hoy) ?? [];
  const siguiente = deHoy.find(
    (c) => c.status === "confirmed" && new Date(c.ends_at) > ahora
  )?.id;

  return (
    <main className="flex flex-col gap-8 max-w-xl mx-auto">
      <header>
        <p className="label">{puesto.salon_name}</p>
        <h1 className="font-display text-3xl font-semibold">Hola, {nombre}</h1>
        <p className="text-muted mt-1">
          {deHoy.length === 0
            ? "Hoy no tienes citas."
            : `Hoy tienes ${deHoy.length} ${deHoy.length === 1 ? "cita" : "citas"}.`}
        </p>
      </header>

      {porDia.size === 0 && (
        <div className="panel p-6 text-pretty text-muted">
          No tienes citas en los próximos {DIAS} días. Cuando te reserven, aparecerán aquí.
        </div>
      )}

      {[...porDia.entries()].map(([dia, lista]) => (
        <section key={dia} className="flex flex-col gap-3">
          <h2 className="font-semibold first-letter:uppercase">
            {dia === hoy ? "Hoy · " : dia === manana ? "Mañana · " : ""}
            <span className={dia === hoy || dia === manana ? "text-muted font-normal" : ""}>
              {fechaLarga(dia)}
            </span>
          </h2>
          <ul className="flex flex-col gap-3">
            {lista.map((c) => {
              const pasada = new Date(c.starts_at) <= ahora;
              const tel = normalizarTel(c.customer_phone);
              const esSiguiente = c.id === siguiente;
              return (
                <li
                  key={c.id}
                  className={`panel p-4 flex flex-col gap-3 ${esSiguiente ? "ring-1 ring-brand/60" : ""}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-16">
                      <p className="font-display text-2xl leading-none tabular-nums">{hora(c.starts_at)}</p>
                      <p className="text-xs text-muted mt-1 tabular-nums">hasta {hora(c.ends_at)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{c.customer_name}</p>
                      {c.service_name && <p className="text-sm text-muted">{c.service_name}</p>}
                      {c.notes && <p className="text-sm mt-1 text-pretty">«{c.notes}»</p>}
                    </div>
                    {esSiguiente && (
                      <span className="text-xs font-medium text-brand whitespace-nowrap">Siguiente</span>
                    )}
                    {c.status === "completed" && (
                      <span className="text-xs font-medium text-ok whitespace-nowrap">✓ Atendida</span>
                    )}
                    {c.status === "no_show" && (
                      <span className="text-xs font-medium text-danger whitespace-nowrap">✕ No vino</span>
                    )}
                  </div>

                  {tel && (
                    <div className="flex gap-2">
                      <a href={telHref(tel)} className="btn-quiet flex-1 text-center">
                        Llamar
                      </a>
                      <a
                        href={`https://wa.me/${tel.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-quiet flex-1 text-center"
                      >
                        WhatsApp
                      </a>
                    </div>
                  )}

                  {/* Mismo criterio que la agenda del dueño: se marca cuando
                      la cita ya ha empezado, y se puede corregir. */}
                  {pasada && (
                    <div className="flex flex-col gap-2">
                      <p className="label">
                        {c.status === "completed"
                          ? "Marcada como atendida"
                          : c.status === "no_show"
                            ? "Marcada como no presentado"
                            : "¿Vino?"}
                      </p>
                      <div className="flex gap-2">
                        <ActionForm action={marcarMiCita} className="flex-1">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value="completed" />
                          <SubmitButton
                            className={`btn-quiet w-full text-ok ${c.status === "completed" ? "ring-1 ring-ok/40" : ""}`}
                            pendingText="Marcando…"
                          >
                            ✓ Atendida
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={marcarMiCita} className="flex-1">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value="no_show" />
                          <ConfirmSubmit
                            className={`btn-quiet w-full text-danger ${c.status === "no_show" ? "ring-1 ring-danger/40" : ""}`}
                            message={`¿${c.customer_name} no se presentó?`}
                          >
                            ✕ No vino
                          </ConfirmSubmit>
                        </ActionForm>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

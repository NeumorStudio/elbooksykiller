import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import type { Puesto } from "@/lib/puesto";
import Agenda, { type Cita, type Profesional, type Servicio } from "../agenda";
import { apuntarCita, moverCitaEquipo, cancelarCitaEquipo, marcarMiCita } from "./actions";

/**
 * La agenda del trabajador cuando el dueño le ha dado algún permiso (0034):
 * la misma pantalla que la del dueño —calendario, rejilla por profesional,
 * huecos, alta a mano— con lo que le toca.
 *
 * Las citas salen de la RPC `agenda_equipo`, que ya decide cuáles ve y qué
 * datos de cada una. Profesionales, horarios y servicios son públicos (la
 * web de reservas los enseña a cualquiera) y se leen con service role
 * acotado a su salón, para no depender de cómo se crucen las políticas del
 * dueño con una sesión que no es la suya.
 */

type Fila = {
  id: string;
  employee_id: string;
  employee_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  customer_phone: string | null;
  public_token: string | null;
  payment_status: string;
  service_name: string | null;
  price_cents: number | null;
  source: "cliente" | "panel" | null;
};

export default async function AgendaEquipo({ puesto }: { puesto: Puesto }) {
  const tz = puesto.timezone;
  const now = new Date();
  // La misma ventana que la del dueño: del día 1 del mes a 90 días vista.
  const desde = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const hasta = new Date(now.getTime() + 90 * 86400000).toISOString();

  const supabase = await supabaseServer();
  const admin = supabaseAdmin();
  const [{ data, error }, { data: staff }, { data: serviciosRaw }] = await Promise.all([
    supabase.rpc("agenda_equipo", { p_desde: desde, p_hasta: hasta }),
    admin
      .from("employees")
      .select("id, name, working_hours(weekday, start_min, end_min)")
      .eq("salon_id", puesto.salon_id)
      .eq("active", true),
    admin
      .from("services")
      .select("id, name, duration_min")
      .eq("salon_id", puesto.salon_id)
      .eq("active", true)
      .order("name"),
  ]);
  if (error) console.error("agenda_equipo:", error.message);

  const enZona = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const g = (t: string) => p.find((x) => x.type === t)!.value;
    return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
  };
  const enMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

  const citas: Cita[] = ((data as Fila[] | null) ?? []).map((b) => {
    const ini = enZona(b.starts_at);
    const fin = enZona(b.ends_at);
    return {
      id: b.id,
      dia: ini.dia,
      hora: ini.hora,
      iniMin: enMin(ini.hora),
      finMin: fin.dia === ini.dia ? enMin(fin.hora) : 24 * 60,
      pasada: new Date(b.starts_at) < now,
      employee_id: b.employee_id,
      customer_name: b.customer_name,
      // Vacío cuando la RPC no se lo da (cita de un compañero sin permiso
      // para gestionarla): la agenda entonces no pinta la fila del teléfono.
      customer_phone: b.customer_phone ?? "",
      customer_email: null,
      public_token: b.public_token,
      payment_status: b.payment_status,
      status: b.status,
      servicio: b.service_name ?? "",
      profesional: b.employee_name,
      precioCents: b.price_cents ?? 0,
      origen: b.source,
      sellos: null,
    };
  });

  // Sin ver la agenda del equipo, su columna es la única: ni los huecos de
  // los demás ni la opción de apuntarles nada.
  const profesionales: Profesional[] = (
    (staff ?? []) as unknown as {
      id: string;
      name: string;
      working_hours: { weekday: number; start_min: number; end_min: number }[];
    }[]
  )
    .filter((e) => puesto.ver_agenda_equipo || e.id === puesto.employee_id)
    // Él primero: es la columna que más mira.
    .sort((a, b) =>
      a.id === puesto.employee_id ? -1 : b.id === puesto.employee_id ? 1 : a.name.localeCompare(b.name, "es")
    )
    .map((e) => ({ id: e.id, name: e.name, tramos: e.working_hours ?? [] }));

  const ahora = enZona(now.toISOString());
  const nombre = puesto.employee_name.split(" ")[0] || puesto.employee_name;

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="label">{puesto.salon_name}</p>
        <h1 className="font-display text-3xl font-semibold">Hola, {nombre}</h1>
      </header>
      <Agenda
        citas={citas}
        profesionales={profesionales}
        servicios={(serviciosRaw ?? []) as Servicio[]}
        hoy={ahora.dia}
        ahoraMin={enMin(ahora.hora)}
        trabajador={{
          yo: puesto.employee_id,
          apuntar: !!puesto.apuntar_citas,
          acciones: {
            alta: apuntarCita,
            mover: moverCitaEquipo,
            cancelar: cancelarCitaEquipo,
            marcar: marcarMiCita,
          },
        }}
      />
    </main>
  );
}

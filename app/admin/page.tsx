import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { createSalon, dismissOnboarding } from "./actions";
import Agenda, { type Cita, type Profesional, type Servicio } from "./agenda";
import ActionForm from "./action-form";
import SubmitButton from "./submit-button";
import { telHref } from "@/lib/tel";

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  employee_id: string;
  customer_name: string;
  customer_phone: string;
  payment_status: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
};

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("*")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) {
    return (
      <main className="mx-auto max-w-md pt-8">
        <h1 className="font-display text-3xl font-semibold">Crea tu peluquería</h1>
        <p className="text-muted mt-2 mb-8">
          Dos datos y tienes tu web de reservas funcionando.
        </p>
        <ActionForm action={createSalon} className="panel p-6 flex flex-col gap-4">
          <div>
            <label htmlFor="s-name" className="label">Nombre del salón</label>
            <input id="s-name" name="name" required placeholder="Barbería Paco" className="field" />
          </div>
          <div>
            <label htmlFor="s-slug" className="label">Dirección web</label>
            <input id="s-slug" name="slug" required minLength={3} placeholder="barberia-paco" className="field" />
            <p className="text-xs text-muted mt-1.5">
              Tus clientes reservarán en tu-web/<b>lo-que-pongas</b> — podrás
              conectar un dominio propio después.
            </p>
          </div>
          <div>
            <label htmlFor="s-phone" className="label">Teléfono (opcional)</label>
            <input id="s-phone" name="phone" type="tel" className="field" />
          </div>
          <div>
            <label htmlFor="s-address" className="label">Dirección (opcional)</label>
            <input id="s-address" name="address" className="field" />
          </div>
          <SubmitButton className="btn-primary mt-2" pendingText="Creando…">Crear mi peluquería</SubmitButton>
        </ActionForm>
      </main>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const [
    { data: upcomingRaw },
    { data: monthBookings },
    { count: serviceCount },
    { data: staffed },
    { data: serviciosRaw },
  ] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, starts_at, ends_at, employee_id, customer_name, customer_phone, payment_status, services(name, price_cents), employees(name)"
        )
        .eq("salon_id", salon.id)
        // Desde el arranque del mes en curso y hasta 90 días: la rejilla
        // necesita la ocupación de los días para poder negociar una fecha
        // lejana ("en tres semanas, un sábado"), no solo lo que viene ya.
        .gte("starts_at", monthStart)
        .lt("starts_at", new Date(now.getTime() + 90 * 86400000).toISOString())
        .eq("status", "confirmed")
        .order("starts_at")
        .limit(400),
      supabase
        .from("bookings")
        .select("services(price_cents)")
        .eq("salon_id", salon.id)
        .gte("starts_at", monthStart)
        // Sin el tope, "este mes" sumaba las reservas de todos los meses
        // futuros. pending_payment fuera, igual que en Estadísticas: así
        // los dos números del panel por fin cuadran.
        .lt("starts_at", monthEnd)
        .neq("status", "cancelled")
        .neq("status", "pending_payment"),
      supabase
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salon.id)
        .eq("active", true),
      supabase
        .from("employees")
        .select("id, name, working_hours(weekday, start_min, end_min)")
        .eq("salon_id", salon.id)
        .eq("active", true),
      supabase
        .from("services")
        .select("id, name, duration_min")
        .eq("salon_id", salon.id)
        .eq("active", true)
        .order("name"),
    ]);

  const upcoming = (upcomingRaw ?? []) as unknown as Row[];
  const revenue = (monthBookings ?? []).reduce(
    (sum, b) => sum + ((b.services as unknown as { price_cents: number })?.price_cents ?? 0),
    0
  );

  const dayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: salon.timezone,
    });
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: salon.timezone,
    });

  // Día y hora se resuelven aquí, en la zona del salón: si se dejara al
  // navegador, un dueño de vacaciones en otro huso vería su agenda
  // desplazada.
  const enZona = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: salon.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const g = (t: string) => p.find((x) => x.type === t)!.value;
    return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
  };

  const enMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

  const citas: Cita[] = upcoming.map((b) => {
    const ini = enZona(b.starts_at);
    const fin = enZona(b.ends_at);
    return {
      id: b.id,
      dia: ini.dia,
      hora: ini.hora,
      iniMin: enMin(ini.hora),
      // Una cita que cruza medianoche terminaría "antes" que su inicio;
      // se recorta al final del día para que el bloque no se invierta.
      finMin: fin.dia === ini.dia ? enMin(fin.hora) : 24 * 60,
      pasada: new Date(b.starts_at) < now,
      employee_id: b.employee_id,
      customer_name: b.customer_name,
      customer_phone: b.customer_phone,
      payment_status: b.payment_status,
      servicio: b.services?.name ?? "",
      profesional: b.employees?.name ?? "",
    };
  });
  const zonaAhora = enZona(now.toISOString());
  const hoyEnZona = zonaAhora.dia;
  const ahoraMin = enMin(zonaAhora.hora);

  const servicios = (serviciosRaw ?? []) as Servicio[];
  const profesionales: Profesional[] = (
    (staffed ?? []) as unknown as {
      id: string;
      name: string;
      working_hours: { weekday: number; start_min: number; end_min: number }[];
    }[]
  ).map((e) => ({ id: e.id, name: e.name, tramos: e.working_hours ?? [] }));

  // La primera cita que aún no ha pasado: lo que el dueño mira 40 veces al día.
  const siguiente = upcoming.find((b) => new Date(b.starts_at) >= now);

  // Caja del día: es su nómina, no un informe. Nunca detrás de un menú.
  const inicioHoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const finHoy = new Date(inicioHoy.getTime() + 86400000);
  const deHoy = upcoming.filter((b) => {
    const d = new Date(b.starts_at);
    return d >= inicioHoy && d < finHoy;
  });
  const cobradoHoy = deHoy
    .filter((b) => new Date(b.starts_at) < now)
    .reduce((s, b) => s + (b.services?.price_cents ?? 0), 0);
  const porVenirHoy = deHoy
    .filter((b) => new Date(b.starts_at) >= now)
    .reduce((s, b) => s + (b.services?.price_cents ?? 0), 0);
  const eur = (c: number) =>
    (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  // "12:30" si es hoy; "Mañana, 12:30" o "lunes, 12:30" si no.
  const hoyLabel = dayLabel(now.toISOString());
  const mananaLabel = dayLabel(new Date(now.getTime() + 86400000).toISOString());
  const cuandoSiguiente = (iso: string) => {
    const d = dayLabel(iso);
    if (d === hoyLabel) return timeLabel(iso);
    if (d === mananaLabel) return `Mañana, ${timeLabel(iso)}`;
    return `${d.split(",")[0]}, ${timeLabel(iso)}`;
  };

  const hasServices = (serviceCount ?? 0) > 0;
  const hasTeam = profesionales.some((e) => e.tramos.length > 0);
  const check = (done: boolean) => (
    <span
      aria-hidden
      className={`w-6 h-6 rounded-full border shrink-0 inline-flex items-center justify-center text-sm mt-0.5
        ${done ? "border-ok bg-ok/10 text-ok" : "border-line text-muted"}`}
    >
      {done ? "✓" : ""}
    </span>
  );

  return (
    <main className="flex flex-col gap-8">
      {!salon.onboarded && (
        // Plegada cuando ya hay citas: la guía ocupaba la primera pantalla
        // del móvil entera antes de dejar ver la agenda.
        <details className="panel p-6" open={upcoming.length === 0}>
          <summary className="cursor-pointer select-none marker:text-brand">
            <span className="font-display text-2xl font-semibold">
              Bienvenido — tu web ya existe 👋
            </span>
            <span className="block text-muted mt-1 text-pretty text-base font-normal">
              Con estos pasos empiezas a recibir reservas. Esta guía desaparece
              cuando tú quieras.
            </span>
          </summary>
          <ol className="flex flex-col gap-3 mt-4">
            <li className="flex gap-3">
              {check(hasServices)}
              <p className="text-sm text-pretty">
                <Link href="/admin/services" className="font-semibold underline underline-offset-4">
                  Servicios
                </Link>{" "}
                — lo que tus clientes pueden reservar, con precio y duración.
              </p>
            </li>
            <li className="flex gap-3">
              {check(hasTeam)}
              <p className="text-sm text-pretty">
                <Link href="/admin/employees" className="font-semibold underline underline-offset-4">
                  Equipo y horarios
                </Link>{" "}
                — quién trabaja y cuándo: de aquí salen los huecos libres. También
                se bloquean vacaciones y ausencias.
              </p>
            </li>
            <li className="flex gap-3">
              {check(salon.charges_enabled)}
              <p className="text-sm text-pretty">
                <Link href="/admin/payments" className="font-semibold underline underline-offset-4">
                  Cobros
                </Link>{" "}
                <span className="text-muted">(opcional)</span> — cobra una señal o
                la cita al reservar; el dinero va directo a tu banco.
              </p>
            </li>
            <li className="flex gap-3">
              {check(!!salon.custom_domain)}
              <p className="text-sm text-pretty">
                <Link href="/admin/website" className="font-semibold underline underline-offset-4">
                  Mi web
                </Link>{" "}
                — comparte tu dirección con tus clientes, o conecta tu propio
                dominio.
              </p>
            </li>
          </ol>
          <p className="text-sm text-muted text-pretty mt-4">
            💡 Truco: el botón 🎤 de abajo lo configura todo por voz — di
            «añade el servicio corte caballero a 15 euros, 30 minutos» y confirma.
            Las citas aparecerán aquí en la Agenda, y en Estadísticas verás cómo va
            el negocio.
          </p>
          <form action={dismissOnboarding} className="mt-4">
            <button className="btn-quiet text-sm">Entendido, no volver a mostrar</button>
          </form>
        </details>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="font-display text-3xl font-semibold">Agenda</h1>
        <p className="text-sm text-muted">
          Este mes: <b className="text-ink">{monthBookings?.length ?? 0} citas</b>
          {" · "}
          <b className="text-ink">{eur(revenue)}</b> estimados
        </p>
      </div>

      {/* La caja del día. Para quien trabaja a comisión o alquila sillón,
          este número es literalmente su nómina — esconderlo detrás de un
          menú "Informes" se siente como esconderle su propio dinero. */}
      {deHoy.length > 0 && (
        <div className="neu-in flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl px-5 py-4">
          <span className="rotulo after:hidden">Hoy</span>
          <span className="font-display text-3xl tabular-nums text-brand">{eur(cobradoHoy)}</span>
          {porVenirHoy > 0 && (
            <span className="text-muted">+ {eur(porVenirHoy)} por venir</span>
          )}
          <span className="w-full text-sm text-muted">
            {deHoy.length} {deHoy.length === 1 ? "cita" : "citas"} ·{" "}
            {deHoy.filter((b) => new Date(b.starts_at) < now).length} pasadas
          </span>
        </div>
      )}

      {/* Lo primero que necesita quien mira tres segundos entre dos cortes:
          quién viene ahora, no un libro mayor. */}
      {siguiente && (
        <section
          aria-label="Siguiente cliente"
          className="tarjeta bg-surface-2 border-brand/30 p-5 sm:p-6 flex items-center gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="rotulo">Siguiente cliente</p>
            {/* El salto de escala es lo que hace que se lea de un vistazo a
                un metro de distancia; el color no basta. */}
            <p className="mt-3 font-display text-4xl leading-none text-brand tabular-nums">
              {cuandoSiguiente(siguiente.starts_at)}
            </p>
            <p className="mt-2 text-lg font-medium truncate">{siguiente.customer_name}</p>
            <p className="text-sm text-muted truncate">
              {siguiente.services?.name}
              {siguiente.employees?.name && ` · con ${siguiente.employees.name}`}
            </p>
          </div>
          <a
            href={telHref(siguiente.customer_phone)}
            className="btn-quiet shrink-0 text-sm"
          >
            Llamar
          </a>
        </section>
      )}

      {upcoming.length === 0 && (
        <div className="panel p-10 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/agenda-vacia.webp"
            alt=""
            width={640}
            height={640}
            loading="lazy"
            className="mx-auto mb-4 h-28 w-28 object-contain"
            // darken: el crema del PNG se funde con el panel y queda solo
            // el trazo ocre.
            style={{ mixBlendMode: "darken" }}
          />
          <p className="text-lg font-medium">No hay citas pendientes</p>
          <p className="text-muted mt-2 max-w-md mx-auto text-pretty">
            {serviceCount === 0
              ? "Para que tus clientes puedan reservar, añade primero tus servicios y el horario de tu equipo."
              : "Comparte tu web con tus clientes y las citas aparecerán aquí."}
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            {serviceCount === 0 ? (
              <>
                <Link href="/admin/services" className="btn-primary">Añadir servicios</Link>
                <Link href="/admin/employees" className="btn-quiet">Configurar equipo</Link>
              </>
            ) : (
              <Link href={`/${salon.slug}`} target="_blank" className="btn-primary">
                Abrir mi web ↗
              </Link>
            )}
          </div>
        </div>
      )}

      <Agenda
        citas={citas}
        profesionales={profesionales}
        servicios={servicios}
        hoy={hoyEnZona}
        ahoraMin={ahoraMin}
      />

    </main>
  );
}

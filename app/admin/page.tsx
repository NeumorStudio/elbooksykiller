import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { dismissOnboarding } from "./actions";
import { OPERADOR } from "@/lib/legal";
import { features } from "@/lib/features";
import Agenda, { type Cita, type Profesional, type Servicio } from "./agenda";
import Ayuda from "./ayuda";
import { esSuperadmin } from "@/lib/superadmin";
import { estadoSalon, moduloActivo } from "@/lib/modulos";

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  employee_id: string;
  customer_id?: string | null;
  public_token?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  payment_status: string;
  status: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
};

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  /**
   * El superadmin va a su panel… salvo que él mismo tenga peluquería.
   *
   * Antes el rebote era incondicional, y eso rompía «Entrar como» cuando el
   * salón de destino era suyo: se canjeaba la sesión del dueño, se volvía a
   * /admin, y de ahí otra vez a /admin/super. Desde fuera parecía que el
   * botón no hacía nada. Pasa en cuanto un operador se da de alta un salón
   * para probar, que es exactamente lo que hay en la base de pruebas.
   *
   * Con salón propio se le enseña su agenda, que es lo que ha pedido; el
   * enlace a Superadmin sigue en la barra de arriba para volver.
   */
  const { data: salon } = await supabase
    .from("salons")
    .select("*")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  // Superadmin sin peluquería propia: su sitio es el panel de plataforma, no
  // el onboarding de «crea tu salón».
  if (!salon && esSuperadmin(user?.email)) redirect("/admin/super");

  // Cerrar el agujero: en cuanto hay clientes con cuenta, un cliente que
  // aterrice en /admin no debe ver el onboarding de "crea tu peluquería".
  // Si tiene ficha de cliente y no es dueño de ningún salón, es un cliente:
  // a su perfil.
  if (!salon) {
    const { clientes } = await features();
    if (clientes) {
      const { data: esCliente } = await supabase
        .from("customers")
        .select("id")
        .eq("auth_user_id", user!.id)
        .limit(1)
        .maybeSingle();
      if (esCliente) redirect("/perfil");
    }
  }

  // Sin salón no hay nada que hacer aquí: las altas las damos nosotros a
  // mano. Quien llegue a esta pantalla es una cuenta creada pero todavía sin
  // salón asignado, o alguien que se registró por su cuenta.
  if (!salon) {
    return (
      <main className="mx-auto max-w-md pt-8">
        <h1 className="font-display text-3xl font-semibold">Tu cuenta aún no tiene salón</h1>
        <div className="panel p-6 mt-6 flex flex-col gap-3">
          <p className="text-pretty">
            Damos de alta las peluquerías una a una para acompañar la puesta en
            marcha. Escríbenos y te montamos la tuya.
          </p>
          <p className="text-pretty text-muted text-sm">
            Si ya has hablado con nosotros, cierra sesión y vuelve a entrar con
            el correo que nos diste — es en esa cuenta donde está tu salón.
          </p>
          {/* El mismo contacto del aviso legal: uno solo que mantener. Sin
              LEGAL_EMAIL no se pinta un mailto roto. */}
          {OPERADOR.email && (
            <a href={`mailto:${OPERADOR.email}`} className="btn-primary mt-2 text-center">
              Escribirnos
            </a>
          )}
        </div>
      </main>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  // customer_id solo existe tras la migración 0006; pedirlo antes rompería
  // la consulta entera.
  const f = await features();

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
          "id, starts_at, ends_at, employee_id, customer_name, customer_phone, customer_email, payment_status, status" +
            // public_token sale de la 0006 igual que customer_id: sin esa
            // migración no existe y pedirlo rompería la consulta entera.
            (f.clientes ? ", customer_id, public_token" : "") +
            ", services(name, price_cents), employees(name)"
        )
        .eq("salon_id", salon.id)
        // Desde el arranque del mes en curso y hasta 90 días: la rejilla
        // necesita la ocupación de los días para poder negociar una fecha
        // lejana ("en tres semanas, un sábado"), no solo lo que viene ya.
        .gte("starts_at", monthStart)
        .lt("starts_at", new Date(now.getTime() + 90 * 86400000).toISOString())
        /**
         * También las ya cerradas, no solo las confirmadas.
         *
         * Antes la agenda pedía únicamente `confirmed`, y como el cron marca
         * «completada» sola unas horas después de la cita, esa cita
         * DESAPARECÍA de la pantalla — con ella, los botones de «atendida» y
         * «no vino». La ventana real para decir que alguien no vino era de
         * unas horas, y pasada esa tarde ya no había forma de arreglarlo
         * desde ningún sitio del panel. De ahí que el contador de no
         * presentados marcara siempre cero y que las faltas no llegaran a
         * dispararse nunca.
         *
         * Las canceladas siguen fuera: esas ya no ocupan hueco ni hay nada
         * que marcar en ellas.
         */
        .in("status", ["confirmed", "completed", "no_show"])
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

  // Distintivo de sellos en la fila: el barbero necesita saber que el
  // siguiente va gratis ANTES de cortar, no después. Solo con el programa
  // activo, y en una consulta para todas las citas visibles.
  let sellosDe = new Map<string, number>();
  let programa: { required_visits: number; reward: string } | null = null;
  if (f.fidelizacion) {
    const { data: prog } = await supabase
      .from("loyalty_programs")
      .select("active, required_visits, reward")
      .eq("salon_id", salon.id)
      .maybeSingle();
    if (prog?.active) {
      programa = { required_visits: prog.required_visits, reward: prog.reward };
      const ids = [...new Set(upcoming.map((b) => b.customer_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: stamps } = await supabase
          .from("loyalty_stamps")
          .select("customer_id")
          .in("customer_id", ids)
          .is("redemption_id", null);
        for (const st of stamps ?? []) {
          sellosDe.set(st.customer_id, (sellosDe.get(st.customer_id) ?? 0) + 1);
        }
      }
    }
  }

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
      customer_email: b.customer_email,
      public_token: b.public_token ?? null,
      payment_status: b.payment_status,
      status: b.status,
      servicio: b.services?.name ?? "",
      profesional: b.employees?.name ?? "",
      precioCents: b.services?.price_cents ?? 0,
      sellos:
        programa && b.customer_id != null && sellosDe.has(b.customer_id)
          ? {
              tiene: sellosDe.get(b.customer_id)!,
              requiere: programa.required_visits,
              premio: programa.reward,
            }
          : null,
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

  // Si el superadmin apagó los cobros, ese paso de la guía sobra.
  const conCobros = moduloActivo(await estadoSalon(salon.id), "cobros");
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
            {conCobros && (
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
            )}
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
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Agenda</h1>
          <Ayuda titulo="Agenda">
            <p>
              Aquí están todas tus citas. Cada reserva que hace un cliente en
              tu web aparece sola, al momento — no tienes que apuntar nada.
            </p>
            <p>
              <b>Para ver un día</b>, tócalo en el calendario. Debajo salen sus
              citas por horas.
            </p>
            <p>
              <b>Para apuntar una cita a mano</b> (alguien que llama por
              teléfono o entra por la puerta), toca un hueco libre del día y
              rellena el nombre. También puedes usar el botón 🎤 de abajo y
              decirlo con la voz.
            </p>
            <p>
              <b>Al tocar una cita</b> se abre su ficha: ahí puedes llamar al
              cliente, cancelarla o marcar que no vino.
            </p>
            <p>
              La cifra de «Hoy» es lo que llevas hecho hoy en euros; «por
              venir» es lo que queda pendiente del día.
            </p>
          </Ayuda>
        </span>
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

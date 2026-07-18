import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { createSalon, cancelBooking, dismissOnboarding } from "./actions";
import ActionForm from "./action-form";
import ConfirmSubmit from "./confirm-submit";
import SubmitButton from "./submit-button";

type Row = {
  id: string;
  starts_at: string;
  customer_name: string;
  customer_phone: string;
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

  const [{ data: upcomingRaw }, { data: monthBookings }, { count: serviceCount }, { data: staffed }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("id, starts_at, customer_name, customer_phone, services(name, price_cents), employees(name)")
        .eq("salon_id", salon.id)
        .gte("starts_at", now.toISOString())
        .neq("status", "cancelled")
        .order("starts_at")
        .limit(80),
      supabase
        .from("bookings")
        .select("services(price_cents)")
        .eq("salon_id", salon.id)
        .gte("starts_at", monthStart)
        .neq("status", "cancelled"),
      supabase
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salon.id)
        .eq("active", true),
      supabase
        .from("employees")
        .select("id, working_hours(id)")
        .eq("salon_id", salon.id)
        .eq("active", true),
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

  const byDay = new Map<string, Row[]>();
  for (const b of upcoming) {
    const key = dayLabel(b.starts_at);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }

  const hasServices = (serviceCount ?? 0) > 0;
  const hasTeam = (staffed ?? []).some(
    (e) => (e.working_hours as { id: string }[]).length > 0
  );
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
        <section className="panel p-6 flex flex-col gap-4" aria-label="Primeros pasos">
          <div>
            <h2 className="font-display text-2xl font-semibold">
              Bienvenido — tu web ya existe 👋
            </h2>
            <p className="text-muted mt-1 text-pretty">
              Con estos pasos empiezas a recibir reservas. Esta guía desaparece
              cuando tú quieras.
            </p>
          </div>
          <ol className="flex flex-col gap-3">
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
          <p className="text-sm text-muted text-pretty">
            💡 Truco: el botón 🎤 de abajo lo configura todo por voz — di
            «añade el servicio corte caballero a 15 euros, 30 minutos» y confirma.
            Las citas aparecerán aquí en la Agenda, y en Estadísticas verás cómo va
            el negocio.
          </p>
          <form action={dismissOnboarding}>
            <button className="btn-quiet text-sm">Entendido, no volver a mostrar</button>
          </form>
        </section>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="font-display text-3xl font-semibold">Agenda</h1>
        <p className="text-sm text-muted">
          Este mes: <b className="text-ink">{monthBookings?.length ?? 0} citas</b>
          {" · "}
          <b className="text-ink">
            {(revenue / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
          </b>{" "}
          estimados
        </p>
      </div>

      {upcoming.length === 0 && (
        <div className="panel p-10 text-center">
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

      {[...byDay.entries()].map(([label, rows]) => (
        <section key={label}>
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3 first-letter:uppercase">
            {label}
          </h2>
          <ul className="panel divide-y divide-line">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center gap-4 p-4">
                <span className="font-semibold tabular-nums text-lg w-14 shrink-0">
                  {timeLabel(b.starts_at)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {b.customer_name}
                    <span className="text-muted font-normal"> · {b.services?.name}</span>
                  </p>
                  <p className="text-sm text-muted truncate">
                    <a href={`tel:${b.customer_phone}`} className="hover:underline">
                      {b.customer_phone}
                    </a>
                    {" · "}con {b.employees?.name}
                  </p>
                </div>
                <form action={cancelBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <ConfirmSubmit
                    message={`¿Cancelar la cita de ${b.customer_name}? Si dejó su email, se le avisará automáticamente.`}
                  >
                    Cancelar
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

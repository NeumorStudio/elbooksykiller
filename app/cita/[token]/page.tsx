import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { telHref } from "@/lib/tel";
import CancelarBoton from "./cancelar-boton";
import Avisos from "./avisos";
import Valorar from "./valorar";

/**
 * La cita del cliente, sin cuenta: el token de la URL es la identidad.
 *
 * Es la URL permanente que faltaba — antes la confirmación vivía solo en
 * sessionStorage y cancelar significaba llamar por teléfono. El canal
 * principal es el navegador interno de Instagram, donde los logins se
 * rompen; por eso el token es el plan A y el login (si llega) el plan B.
 *
 * Lee con service role tras validar el token: nada pasa por políticas RLS
 * abiertas a anon (la lección de public_read_salons).
 */

// La URL lleva el token: los buscadores no deben guardarla.
export const metadata: Metadata = {
  title: "Tu cita",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fila = {
  id: string;
  status: string;
  payment_status: string;
  starts_at: string;
  ends_at: string;
  customer_id: string | null;
  customer_name: string;
  services: { name: string; price_cents: number; duration_min: number };
  employees: { name: string };
  salons: {
    id: string;
    name: string;
    slug: string;
    phone: string | null;
    address: string | null;
    timezone: string;
    logo_url: string | null;
    google_review_url?: string | null;
  };
};

const fmtPrice = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export default async function CitaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const f = await features();
  // Sin la migración 0006 no existe public_token: la ruta entera no existe.
  if (!f.clientes || !UUID_RE.test(token)) notFound();

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, status, payment_status, starts_at, ends_at, customer_id, customer_name, " +
        "services(name, price_cents, duration_min), employees(name), " +
        `salons(id, name, slug, phone, address, timezone, logo_url${f.resenas ? ", google_review_url" : ""})`
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!data) notFound();
  const b = data as unknown as Fila;
  const salon = b.salons;

  // ── Productos apartados con la cita ──────────────────────────────────
  const apartados = f.productos
    ? ((
        await admin
          .from("booking_products")
          .select("quantity, unit_price_cents, products(name)")
          .eq("booking_id", b.id)
      ).data ?? [])
    : [];

  // ── Tarjeta de sellos ────────────────────────────────────────────────
  let tarjeta: { tiene: number; requiere: number; premio: string } | null = null;
  if (f.fidelizacion && b.customer_id) {
    const { data: prog } = await admin
      .from("loyalty_programs")
      .select("active, required_visits, reward")
      .eq("salon_id", salon.id)
      .maybeSingle();
    if (prog?.active) {
      const { count } = await admin
        .from("loyalty_stamps")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", b.customer_id)
        .is("redemption_id", null);
      tarjeta = {
        tiene: count ?? 0,
        requiere: prog.required_visits,
        premio: prog.reward,
      };
    }
  }

  // ── Valoración previa (si la hay) ────────────────────────────────────
  let notaPrevia: number | null = null;
  if (f.resenas && b.status === "completed") {
    const { data: rr } = await admin
      .from("review_requests")
      .select("rating")
      .eq("booking_id", b.id)
      .maybeSingle();
    notaPrevia = rr?.rating ?? null;
  }

  const tz = salon.timezone;
  const inicio = new Date(b.starts_at);
  const cuandoDia = inicio.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: tz,
  });
  const cuandoHora = inicio.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  });

  const esFutura = inicio.getTime() > Date.now();
  const margen = inicio.getTime() - Date.now() > 2 * 60 * 60 * 1000;
  const activa = ["confirmed", "pending_payment"].includes(b.status) && esFutura;

  // Añadir al calendario: mismo formato que la confirmación del widget.
  const finCal = new Date(inicio.getTime() + b.services.duration_min * 60000);
  const fCal = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const titulo = `${b.services.name} en ${salon.name}`;
  // El .ics se sirve desde /cita/[token]/cita.ics: generarlo aquí en un
  // `data:` hacía que el botón no hiciera nada en el navegador del correo.
  const gcal =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(titulo)}` +
    `&dates=${fCal(inicio)}/${fCal(finCal)}` +
    (salon.address ? `&location=${encodeURIComponent(salon.address)}` : "");

  const mapa = salon.address
    ? `https://maps.google.com/?q=${encodeURIComponent(`${salon.name}, ${salon.address}`)}`
    : null;

  const chip = (() => {
    if (b.status === "cancelled")
      return { texto: "Cancelada", clase: "text-danger border-danger/40" };
    if (b.status === "no_show")
      return { texto: "No asistió", clase: "text-muted border-line" };
    if (b.status === "completed")
      return { texto: "Completada", clase: "text-ok border-ok/40" };
    if (b.status === "pending_payment")
      return { texto: "Pago pendiente", clase: "text-muted border-line" };
    return esFutura
      ? { texto: "Confirmada", clase: "text-ok border-ok/40" }
      : { texto: "Pasada", clase: "text-muted border-line" };
  })();

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-12 flex-1 flex flex-col gap-6">
      <header className="text-center">
        {salon.logo_url && (
          <span className="plato-logo mx-auto mb-4">
            {/* Desde la ficha de la cita, el logo devuelve a la web del
                salón: es donde se pide otra o se miran los servicios, y
                hasta ahora esta página era un callejón sin salida — se
                llega por el enlace del email y no hay nada más. */}
            <Link
              href={`/${salon.slug}`}
              aria-label={`Ir al inicio de ${salon.name}`}
              className="block rounded-xl focus-visible:outline-2
                focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={salon.logo_url}
                alt=""
                width={512}
                height={512}
                className="h-16 w-16 rounded-xl object-contain"
              />
            </Link>
          </span>
        )}
        <p className="text-sm text-muted">Tu cita en</p>
        <h1 className="font-display text-3xl font-semibold text-brand text-balance">
          {salon.name}
        </h1>
      </header>

      {/* ── La cita ─────────────────────────────────────────────────── */}
      <section className="neu-in rounded-2xl px-6 py-5 text-center">
        <span
          className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${chip.clase}`}
        >
          {chip.texto}
        </span>
        <p className="mt-3 font-display text-3xl text-ink first-letter:uppercase text-balance">
          {cuandoDia}
        </p>
        <p className="font-display text-4xl text-brand tabular-nums">{cuandoHora}</p>
        <p className="mt-3 text-muted">
          {b.services.name} · {b.services.duration_min} min · con {b.employees.name}
        </p>
        <p className="font-semibold tabular-nums">{fmtPrice(b.services.price_cents)}</p>

        {apartados.length > 0 && (
          <div className="mt-4 border-t border-line-subtle pt-3 text-sm">
            {apartados.map((a, i) => {
              const p = a as unknown as {
                quantity: number;
                unit_price_cents: number;
                products: { name: string };
              };
              return (
                <p key={i} className="text-muted">
                  Apartado: <span className="text-ink">{p.products.name}</span>
                  {p.quantity > 1 && ` ×${p.quantity}`} ·{" "}
                  {fmtPrice(p.unit_price_cents * p.quantity)}
                </p>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Acciones según el estado ────────────────────────────────── */}
      {activa && (
        <section className="flex flex-col items-center gap-4">
          <div className="flex flex-wrap justify-center gap-2">
            {/* Sin target="_blank" a propósito: este enlace se abre desde el
                email, y el navegador integrado de Gmail y Outlook ignora la
                petición de pestaña nueva — el botón se quedaba muerto sin
                dar ni error. En el mismo destino funciona siempre, y en el
                móvil el sistema entrega el enlace a la app de Calendario o
                de Mapas igual. */}
            <a href={`/cita/${token}/cita.ics`} className="btn-quiet text-sm">
              Añadir al calendario
            </a>
            <a href={gcal} rel="noopener" className="btn-quiet text-sm">
              Google Calendar
            </a>
            {mapa && (
              <a href={mapa} rel="noopener" className="btn-quiet text-sm">
                Cómo llegar
              </a>
            )}
          </div>
          {/* Solo con la cita viva y clave configurada: ofrecer un aviso que
              no se puede mandar es peor que no ofrecerlo. */}
          {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && b.customer_id && (
            <Avisos
              token={token}
              claveVapid={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
            />
          )}
          {margen ? (
            <CancelarBoton token={token} pagada={b.payment_status === "paid"} />
          ) : (
            <p className="text-sm text-muted text-center text-pretty">
              Queda menos de 2 horas: si no puedes venir,{" "}
              {salon.phone ? (
                <a href={telHref(salon.phone)} className="underline underline-offset-4">
                  llámanos al {salon.phone}
                </a>
              ) : (
                "llama al salón"
              )}
              .
            </p>
          )}
        </section>
      )}

      {b.status === "cancelled" && (
        <p className="text-center text-muted text-pretty">
          Esta cita se canceló.
          {b.payment_status === "paid" && " El pago se devolvió."}
        </p>
      )}

      {f.resenas && b.status === "completed" && (
        <Valorar
          token={token}
          yaValorada={notaPrevia}
          googleUrl={salon.google_review_url ?? null}
          salonName={salon.name}
        />
      )}

      {/* ── Tarjeta de fidelidad ────────────────────────────────────── */}
      {tarjeta && (
        <section className="panel p-6 text-center" aria-label="Tarjeta de fidelidad">
          <p className="rotulo justify-center after:hidden">Tu tarjeta</p>
          <div
            className="mt-4 flex flex-wrap justify-center gap-2"
            aria-label={`${tarjeta.tiene} de ${tarjeta.requiere} visitas`}
          >
            {Array.from({ length: tarjeta.requiere }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className={`flex h-10 w-10 items-center justify-center rounded-full font-display text-sm
                  ${i < Math.min(tarjeta.tiene, tarjeta.requiere)
                    ? "bg-brand text-brand-ink"
                    : "neu-in text-faint"}`}
              >
                {i < Math.min(tarjeta.tiene, tarjeta.requiere) ? "✓" : i + 1}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm text-pretty">
            {tarjeta.tiene >= tarjeta.requiere ? (
              <>
                <span className="font-semibold text-brand">{tarjeta.premio}</span>{" "}
                conseguido — díselo al equipo en tu próxima visita.
              </>
            ) : (
              <>
                {tarjeta.tiene} de {tarjeta.requiere} visitas. A{" "}
                {tarjeta.requiere - tarjeta.tiene} de:{" "}
                <span className="font-semibold">{tarjeta.premio}</span>.
              </>
            )}
          </p>
        </section>
      )}

      <footer className="mt-auto pt-6 text-center">
        <Link href={`/${salon.slug}`} className="btn-primary px-8">
          Reservar otra cita
        </Link>
        <p className="mt-6 text-xs text-muted">Reservas por Salonio</p>
      </footer>
    </main>
  );
}

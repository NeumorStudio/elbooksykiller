"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { normalizarTel } from "@/lib/tel";

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Ata la reserva a la cuenta de quien la hizo, si tenía sesión abierta.
 *
 * El trigger de la BD ya crea la ficha de cliente por teléfono en cada
 * reserva; lo que faltaba era el puente con la cuenta, porque el login va
 * por email y el email es opcional al reservar. Reservar estando dentro es
 * la prueba de propiedad: nadie puede reclamar una ficha ajena escribiendo
 * un teléfono. Reservar sin cuenta sigue funcionando igual — esto solo
 * añade coherencia a quien sí entró.
 *
 * Nunca debe romper una reserva: si algo falla, la cita ya está hecha.
 */
async function atarACuenta(
  bookingId: string,
  // Cómo estaba la ficha de ese teléfono ANTES de esta reserva. null = no
  // existía, así que la acaba de crear quien reserva.
  fichaPrevia: { email: string | null } | null
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Escribir un teléfono en un formulario NO prueba que sea tuyo. Solo se
    // vincula si la ficha es nueva (la ha creado esta misma reserva) o si su
    // email ya coincidía con el email verificado de la sesión. Sin esto,
    // reservar con el teléfono de otro le entregaba su ficha al atacante:
    // sus próximas citas, sus tokens de cancelación y sus datos personales.
    if (fichaPrevia) {
      const suyo =
        fichaPrevia.email?.trim().toLowerCase() === user.email?.trim().toLowerCase();
      if (!fichaPrevia.email || !suyo) return;
    }

    const admin = supabaseAdmin();
    const { data: reserva } = await admin
      .from("bookings")
      .select("customer_id")
      .eq("id", bookingId)
      .maybeSingle();
    const customerId = (reserva as { customer_id: string | null } | null)?.customer_id;
    if (!customerId) return; // sin teléfono normalizable no hay ficha

    // Solo si está libre: nunca se le roba la ficha a otra cuenta.
    await admin
      .from("customers")
      .update({ auth_user_id: user.id })
      .eq("id", customerId)
      .is("auth_user_id", null);
  } catch {
    /* el enlace es un extra, la reserva manda */
  }
}

export async function bookAppointment(input: {
  employeeId: string;
  serviceId: string;
  startIso: string;
  name: string;
  phone: string;
  email: string;
  // Productos apartados junto a la cita y consentimiento de newsletter.
  // Solo viajan cuando la página los ofreció (features encendidas).
  productos?: { id: string; qty: number }[];
  marketing?: boolean;
}): Promise<
  | { ok: true; citaUrl?: string; omitidos?: string[] }
  | { checkoutUrl: string }
  | { error: "slot_unavailable" | "invalid" }
  | { error: "blocked"; message: string }
> {
  const anon = anonClient();

  // Qué se cobra y si el salón puede cobrar. Con service role: la cuenta de
  // Stripe del salón ya no es legible con la clave pública (migración 0016),
  // y esto corre en el servidor, no en el navegador.
  const { data: svc } = await supabaseAdmin()
    .from("services")
    .select("name, price_cents, payment_type, deposit_cents, salons(id, slug, name, phone, timezone, stripe_account_id, charges_enabled)")
    .eq("id", input.serviceId)
    .maybeSingle();
  if (!svc) return { error: "invalid" };

  const salon = svc.salons as unknown as {
    id: string; slug: string; name: string; phone: string | null; timezone: string;
    stripe_account_id: string | null; charges_enabled: boolean;
  };
  const amount =
    svc.payment_type === "full" ? svc.price_cents
    : svc.payment_type === "deposit" ? (svc.deposit_cents ?? 0)
    : 0;
  const needsPayment = amount > 0 && salon.charges_enabled && !!salon.stripe_account_id;

  // La validación real (horario, solapes, futuro) vive en la RPC. Con las
  // migraciones aplicadas se usa la v2 (consentimiento + productos, devuelve
  // también el token de la cita); si no, la original — el mismo código
  // desplegado funciona con ambos esquemas.
  const { clientes, penalizaciones } = await (await import("@/lib/features")).features();

  // Cómo está la ficha de ese teléfono ANTES de reservar: hace falta para
  // dos cosas distintas —el castigo por faltas y decidir si la reserva
  // puede atarse a la cuenta abierta (ver atarACuenta)— y después de la
  // RPC ya no se puede saber, porque el trigger la habrá creado o tocado.
  type FichaPrevia = { email: string | null; banned?: boolean; blocked_until?: string | null };
  const tel = clientes ? normalizarTel(input.phone) : null;
  let fichaPrevia: FichaPrevia | null = null;
  if (tel) {
    const { data } = await supabaseAdmin()
      .from("customers")
      .select("email" + (penalizaciones ? ", banned, blocked_until" : ""))
      .eq("salon_id", salon.id)
      .eq("phone", tel)
      .maybeSingle();
    fichaPrevia = (data as unknown as FichaPrevia) ?? null;
  }

  // Escalera de faltas: cliente vetado o en bloqueo temporal no reserva
  // online. La redención pasa por el mostrador: llamar o venir en persona
  // (el alta manual del dueño no pasa por aquí a propósito).
  // ponytail: chequeo en la action, no en la RPC — el widget es la única
  // vía real; si algún día importa el curl directo, muévelo a create_booking.
  if (penalizaciones && fichaPrevia) {
    const { data: prog } = await supabaseAdmin()
      .from("penalty_programs")
      .select("active")
      .eq("salon_id", salon.id)
      .maybeSingle();
    if (prog?.active) {
      const llama = salon.phone ? ` Llama al ${salon.phone} y lo resolvemos.` : " Contacta con el salón y lo resolvemos.";
      if (fichaPrevia.banned) {
        return { error: "blocked", message: `La reserva online no está disponible para este número por citas sin asistir.${llama}` };
      }
      if (fichaPrevia.blocked_until && new Date(fichaPrevia.blocked_until) > new Date()) {
        const hasta = new Date(fichaPrevia.blocked_until).toLocaleDateString("es-ES", {
          day: "numeric", month: "long", timeZone: salon.timezone,
        });
        return { error: "blocked", message: `No puedes reservar online hasta el ${hasta} por citas sin asistir.${llama}` };
      }
    }
  }
  const base_args = {
    p_employee: input.employeeId,
    p_service: input.serviceId,
    p_start: input.startIso,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email || null,
    p_pending_payment: needsPayment,
  };

  let bookingId: string;
  let citaUrl: string | undefined;
  let omitidos: string[] = [];

  if (clientes) {
    const { data, error } = await anon.rpc("create_booking_v2", {
      ...base_args,
      p_marketing: !!input.marketing && !!input.email,
      p_products: input.productos?.length ? input.productos : null,
    });
    if (error) {
      return { error: error.message.includes("slot_unavailable") ? "slot_unavailable" : "invalid" };
    }
    const r = data as { booking_id: string; public_token: string; omitidos: string[] | null };
    bookingId = r.booking_id;
    omitidos = r.omitidos ?? [];
    // Relativa a propósito: este enlace se pinta en la propia página, así que
    // el origen ya es el correcto. Con baseUrl() heredaba el fallback a
    // localhost cuando PLATFORM_URL no está definida y el botón moría.
    citaUrl = `/cita/${r.public_token}`;
  } else {
    const { data, error } = await anon.rpc("create_booking", base_args);
    if (error) {
      return { error: error.message.includes("slot_unavailable") ? "slot_unavailable" : "invalid" };
    }
    bookingId = data as string;
  }

  // Vale para las dos vías (con y sin pago): la cita ya existe en ambas.
  await atarACuenta(bookingId, fichaPrevia);

  if (!needsPayment) {
    await notifyBookingConfirmed(bookingId);
    return { ok: true, citaUrl, omitidos };
  }

  // Cobro directo en la cuenta conectada del salón: el dinero es suyo.
  const base = await origin();
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: amount,
              product_data: {
                name:
                  svc.payment_type === "deposit"
                    ? `Señal — ${svc.name} en ${salon.name}`
                    : `${svc.name} en ${salon.name}`,
              },
            },
          },
        ],
        customer_email: input.email || undefined,
        metadata: { booking_id: bookingId },
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        success_url: `${base}/${salon.slug}?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/${salon.slug}?cancelled=1`,
      },
      { stripeAccount: salon.stripe_account_id! }
    );

    await supabaseAdmin()
      .from("bookings")
      .update({ stripe_session_id: session.id })
      .eq("id", bookingId);

    return { checkoutUrl: session.url! };
  } catch (e) {
    // No se pudo abrir el cobro: liberar el hueco y avisar
    console.error("[stripe] error creando checkout", e);
    await supabaseAdmin()
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", bookingId);
    return { error: "invalid" };
  }
}

// Verificación al volver del pago (camino rápido; el webhook es el respaldo).
// Corre en el servidor: consulta Stripe y confirma la reserva si está pagada.
export async function confirmPaidSession(slug: string, sessionId: string) {
  const admin = supabaseAdmin();
  const { data: salon } = await admin
    .from("salons")
    .select("stripe_account_id, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (!salon?.stripe_account_id) return null;

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      {},
      { stripeAccount: salon.stripe_account_id }
    );
  } catch {
    return null;
  }
  const bookingId = session.metadata?.booking_id;
  if (!bookingId || session.payment_status !== "paid") return null;

  const { data: updated } = await admin
    .from("bookings")
    .update({ status: "confirmed", payment_status: "paid" })
    .eq("id", bookingId)
    .eq("stripe_session_id", sessionId)
    .neq("status", "cancelled")
    .select("starts_at, customer_name, services(name), employees(name)")
    .maybeSingle();
  if (!updated) return null;

  await notifyBookingConfirmed(bookingId);

  return {
    serviceName: (updated.services as unknown as { name: string }).name,
    employeeName: (updated.employees as unknown as { name: string }).name,
    when: new Date(updated.starts_at).toLocaleString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: salon.timezone,
    }),
    customerName: updated.customer_name,
  };
}

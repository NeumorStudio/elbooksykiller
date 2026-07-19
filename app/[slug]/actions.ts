"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { notifyBookingConfirmed } from "@/lib/notifications";

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
> {
  const anon = anonClient();

  // Datos públicos: qué se cobra y si el salón puede cobrar
  const { data: svc } = await anon
    .from("services")
    .select("name, price_cents, payment_type, deposit_cents, salons(slug, name, stripe_account_id, charges_enabled)")
    .eq("id", input.serviceId)
    .maybeSingle();
  if (!svc) return { error: "invalid" };

  const salon = svc.salons as unknown as {
    slug: string; name: string; stripe_account_id: string | null; charges_enabled: boolean;
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
  const { clientes } = await (await import("@/lib/features")).features();
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
    citaUrl = `${(await import("@/lib/urls")).baseUrl()}/cita/${r.public_token}`;
  } else {
    const { data, error } = await anon.rpc("create_booking", base_args);
    if (error) {
      return { error: error.message.includes("slot_unavailable") ? "slot_unavailable" : "invalid" };
    }
    bookingId = data as string;
  }

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

"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import {
  sendEmail,
  ownerCancelledByCustomerHtml,
  ownerLowRatingHtml,
} from "@/lib/email";

/**
 * Acciones del cliente final sobre SU cita, autenticadas por el token de la
 * URL — no por sesión. El canal principal es el navegador interno de
 * Instagram, donde los logins se rompen; el token es el plan A.
 *
 * Todo corre con service role tras validar el token: nada de esto pasa por
 * políticas RLS abiertas a anon (la lección de public_read_salons).
 */

// El token va a la consulta: si no tiene forma de UUID, ni se pregunta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtWhen = (iso: string, tz: string) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  });

async function ownerEmail(ownerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  return data?.user?.email ?? null;
}

/**
 * Guarda la suscripción push de este móvil para el cliente de esta cita.
 *
 * El token hace de credencial: solo quien tiene el enlace de la cita puede
 * atar un dispositivo a esa ficha. Sin esa comprobación, cualquiera podría
 * suscribir su móvil a los avisos de otro cliente.
 *
 * Sin `customer_id` no hay a quién atarla — reserva de paso, sin ficha— y
 * se devuelve error en vez de guardar algo huérfano.
 */
export async function guardarPush(
  token: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ error?: string }> {
  if (!UUID_RE.test(token)) return { error: "Enlace no válido." };
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: "Suscripción incompleta." };
  }

  const admin = supabaseAdmin();
  const { data: b } = await admin
    .from("bookings")
    .select("customer_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!b?.customer_id) return { error: "Esta cita no está ligada a una ficha." };

  // onConflict en endpoint: volver a suscribir el mismo móvil lo actualiza
  // en vez de duplicarlo. El navegador puede rotar las claves del mismo
  // endpoint, así que se refrescan siempre.
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      customer_id: b.customer_id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      fallos: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("guardarPush:", error.message);
    return { error: "No se pudo activar el aviso. Inténtalo de nuevo." };
  }
  return {};
}

export async function cancelarCita(token: string): Promise<{ error?: string }> {
  const { clientes } = await features();
  if (!clientes) return { error: "No disponible todavía." };

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, status, starts_at, payment_status, stripe_session_id, customer_name, services(name), salons(name, timezone, owner_id, stripe_account_id)"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!data) return { error: "Esta cita no existe." };

  const b = data as unknown as {
    id: string; status: string; starts_at: string; payment_status: string;
    stripe_session_id: string | null; customer_name: string;
    services: { name: string };
    salons: { name: string; timezone: string; owner_id: string; stripe_account_id: string | null };
  };

  if (b.status === "cancelled") return {}; // ya estaba: idempotente
  if (["completed", "no_show"].includes(b.status))
    return { error: "Esta cita ya pasó." };

  // Margen de 2 horas: más cerca del inicio, el hueco ya no se recoloca y
  // la cancelación se habla por teléfono, no con un botón.
  if (new Date(b.starts_at).getTime() - Date.now() < 2 * 60 * 60 * 1000)
    return { error: "Queda menos de 2 horas: llama al salón para cancelar." };

  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", b.id)
    .in("status", ["confirmed", "pending_payment"]);
  if (error) return { error: "No se pudo cancelar. Inténtalo de nuevo." };

  // Si había pagado, devolverle el dinero — mismo comportamiento que cuando
  // cancela el salón: cancelar sin devolver es quedarse dinero de una
  // persona que no va a venir.
  let refunded = false;
  if (b.payment_status === "paid" && b.stripe_session_id) {
    try {
      const { stripe } = await import("@/lib/stripe");
      const cuenta = b.salons.stripe_account_id
        ? { stripeAccount: b.salons.stripe_account_id }
        : undefined;
      const sesion = await stripe.checkout.sessions.retrieve(b.stripe_session_id, {}, cuenta);
      if (sesion.payment_intent) {
        await stripe.refunds.create(
          { payment_intent: String(sesion.payment_intent) },
          cuenta
        );
        refunded = true;
      }
    } catch (e) {
      console.error("[stripe] reembolso al cancelar por token", b.id, e);
    }
  }

  // El dueño se entera al momento: un hueco liberado a tiempo se rellena.
  const to = await ownerEmail(b.salons.owner_id);
  if (to) {
    await sendEmail({
      to,
      subject: `Cancelación: ${b.services.name} — ${fmtWhen(b.starts_at, b.salons.timezone)}`,
      html: ownerCancelledByCustomerHtml({
        customerName: b.customer_name,
        serviceName: b.services.name,
        when: fmtWhen(b.starts_at, b.salons.timezone),
        refunded,
      }),
      idempotencyKey: `cancel-token/${b.id}`,
    });
  }

  revalidatePath(`/cita/${token}`);
  return {};
}

export async function valorar(token: string, rating: number): Promise<{ error?: string }> {
  const { resenas } = await features();
  if (!resenas) return { error: "No disponible todavía." };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { error: "Valoración inválida." };

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, status, starts_at, customer_id, customer_name, salon_id, services(name), salons(timezone, owner_id)"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!data) return { error: "Esta cita no existe." };

  const b = data as unknown as {
    id: string; status: string; starts_at: string; customer_id: string | null;
    customer_name: string; salon_id: string;
    services: { name: string };
    salons: { timezone: string; owner_id: string };
  };

  if (b.status !== "completed") return { error: "Solo se valora una visita ya hecha." };

  // Una valoración por cita; la primera queda (upsert que no pisa).
  const { data: previa } = await admin
    .from("review_requests")
    .select("rating")
    .eq("booking_id", b.id)
    .maybeSingle();
  if (previa?.rating) return {}; // ya valorada: idempotente

  const { error } = await admin.from("review_requests").upsert(
    {
      booking_id: b.id,
      customer_id: b.customer_id,
      salon_id: b.salon_id,
      rating,
      rated_at: new Date().toISOString(),
    },
    { onConflict: "booking_id" }
  );
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };

  // Nota baja → el dueño lo sabe hoy, no cuando lo lea en Google.
  if (rating <= 3) {
    const to = await ownerEmail(b.salons.owner_id);
    if (to) {
      await sendEmail({
        to,
        subject: `Valoración de ${rating}/5 — ${b.customer_name}`,
        html: ownerLowRatingHtml({
          customerName: b.customer_name,
          serviceName: b.services.name,
          when: fmtWhen(b.starts_at, b.salons.timezone),
          rating,
        }),
        idempotencyKey: `low-rating/${b.id}`,
      });
    }
  }

  revalidatePath(`/cita/${token}`);
  return {};
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avisarCitaCancelada } from "@/lib/avisos-cita";

/**
 * Cancelar una cita desde el lado del salón: el panel web y la app móvil del
 * dueño pasan por aquí, así que hacen exactamente lo mismo — marcar la cita,
 * devolver el dinero si estaba pagada y avisar al cliente.
 *
 * Vivía dentro de la server action `cancelBooking`. Se saca para no tener dos
 * copias de la lógica del reembolso, que es la parte que no se puede permitir
 * divergir.
 *
 * `supabase` es un cliente CON la sesión del dueño (cookie en la web, JWT en la
 * app): RLS decide si la cita es suya. Aquí no se comprueban permisos.
 *
 * Devuelve `no_encontrada` si la cita no existe o no es del salón: con RLS las
 * dos cosas son indistinguibles y no hay que contarle a nadie cuál es.
 */
export async function cancelarCitaDelSalon(
  supabase: SupabaseClient,
  id: string
): Promise<"ok" | "no_encontrada" | "error"> {
  // Leer antes de cancelar (RLS: solo el dueño llega aquí con datos)
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "customer_name, customer_email, starts_at, payment_status, stripe_session_id, services(name), salons(name, phone, timezone, stripe_account_id)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) return "no_encontrada";

  // Marcada como del salón: estas nunca cuentan como cancelación tardía del
  // cliente (ver migración 0026).
  const { cancelaciones } = await (await import("@/lib/features")).features();
  const { error } = await supabase
    .from("bookings")
    .update(
      cancelaciones
        ? { status: "cancelled", cancelled_by: "salon" }
        : { status: "cancelled" }
    )
    .eq("id", id);
  if (error) return "error";

  // Si el cliente había pagado, devolverle el dinero. Antes se cancelaba la
  // cita y el cobro se quedaba hecho, sin aviso ni en la interfaz ni al
  // cliente: dinero real de una persona real que no volvía.
  if (b.payment_status === "paid" && b.stripe_session_id) {
    const salon = b.salons as unknown as { stripe_account_id: string | null };
    try {
      const { stripe } = await import("@/lib/stripe");
      const cuenta = salon.stripe_account_id
        ? { stripeAccount: salon.stripe_account_id }
        : undefined;
      // retrieve() separa params de opciones: {} es el hueco de los params.
      const sesion = await stripe.checkout.sessions.retrieve(b.stripe_session_id, {}, cuenta);
      if (sesion.payment_intent) {
        await stripe.refunds.create(
          {
            payment_intent: String(sesion.payment_intent),
            reason: "requested_by_customer",
          },
          // Clave de idempotencia: si el dueño pulsa dos veces, un solo
          // reembolso.
          { ...cuenta, idempotencyKey: `refund-${id}` }
        );
        // No se marca payment_status: su CHECK solo admite none|pending|paid.
        // El registro del reembolso vive en Stripe; para reflejarlo aquí hace
        // falta una migración que añada 'refunded' al constraint.
      }
    } catch (e) {
      // No romper la cancelación por un fallo de reembolso: la cita queda
      // cancelada y el dueño ve el aviso para devolverlo a mano.
      console.error(`[refund] no se pudo reembolsar la reserva ${id}:`, e);
    }
  }

  await avisarCitaCancelada(id, b);
  return "ok";
}

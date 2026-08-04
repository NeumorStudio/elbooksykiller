"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { MARGEN_CANCELACION_TEXTO, sePuedeCancelar } from "@/lib/cancelacion";
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

/**
 * Deja su correo en la ficha para poder reclamar el historial más tarde.
 *
 * Quien reserva solo con el teléfono acumula visitas y sellos en una ficha
 * sin correo, y luego **no hay forma de que la reclame**: entra en su perfil
 * por enlace mágico, el sistema busca fichas con ese email y no encuentra
 * ninguna. Y atarla por teléfono está prohibido a propósito desde la 0015 —
 * escribir un número en un formulario no demuestra que sea tuyo.
 *
 * Esta es la puerta legítima. El token de la cita ya prueba que la reserva
 * es suya (con él se cancela y se atan los avisos del móvil); guardar aquí
 * el correo y verificarlo después con el enlace mágico encadena las dos
 * pruebas que hacen falta: que la cita es suya y que el correo es suyo.
 *
 * Dos candados: no se pisa un correo ya puesto —esa regla es la que sostiene
 * toda la seguridad del perfil— y no se admite uno que ya use otra ficha del
 * mismo salón, o acabaría viendo las citas de otro.
 */
export async function guardarEmailCliente(
  token: string,
  email: string
): Promise<{ error?: string; ok?: boolean }> {
  const { clientes } = await features();
  if (!clientes) return { error: "No disponible todavía." };
  if (!UUID_RE.test(token)) return { error: "Enlace no válido." };

  const limpio = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(limpio))
    return { error: "Revisa el correo." };

  const admin = supabaseAdmin();
  const { data: b } = await admin
    .from("bookings")
    .select("customer_id, salon_id")
    .eq("public_token", token)
    .maybeSingle();
  const cita = b as { customer_id: string | null; salon_id: string } | null;
  if (!cita?.customer_id) return { error: "Esta cita no está ligada a una ficha." };

  const { data: ficha } = await admin
    .from("customers")
    .select("email")
    .eq("id", cita.customer_id)
    .maybeSingle();
  if (!ficha) return { error: "Esta cita no está ligada a una ficha." };
  // Ya tenía uno: no se toca. Si es el mismo, para el cliente es un éxito.
  if (ficha.email) {
    return ficha.email.trim().toLowerCase() === limpio
      ? { ok: true }
      : { error: "Esta ficha ya tiene otro correo. Díselo al salón para cambiarlo." };
  }

  // `_` y `%` son comodines en ilike: sin escapar, juan_perez@x.com chocaría
  // con juanXperez@x.com y bloquearía un correo legítimo.
  const patron = limpio.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: ocupado } = await admin
    .from("customers")
    .select("id")
    .eq("salon_id", cita.salon_id)
    .ilike("email", patron)
    .maybeSingle();
  if (ocupado) return { error: "Ese correo ya está en otra ficha de este salón." };

  const { error } = await admin
    .from("customers")
    .update({ email: limpio })
    .eq("id", cita.customer_id)
    .is("email", null); // carrera: si alguien lo puso mientras tanto, manda el suyo
  if (error) {
    console.error("guardarEmailCliente:", error.message);
    return { error: "No se pudo guardar. Inténtalo de nuevo." };
  }

  /**
   * A propósito SIN revalidar.
   *
   * Revalidando, el servidor vuelve a pintar la página; como la ficha ya
   * tiene correo, el bloque entero desaparece del árbol y el cliente ve
   * esfumarse el formulario sin que nada le confirme que ha ido bien.
   * Dejando la página como está, el componente enseña su «✓ Correo
   * guardado», y en la siguiente visita ya no aparecerá porque el dato está.
   */
  return { ok: true };
}

export async function cancelarCita(token: string): Promise<{ error?: string }> {
  const { clientes, cancelaciones } = await features();
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

  // El margen y su redacción salen del mismo sitio que los usa la página y
  // los correos: ver lib/cancelacion.ts.
  if (!sePuedeCancelar(b.starts_at))
    return {
      error: `Queda menos de ${MARGEN_CANCELACION_TEXTO}: llama al salón para cancelar.`,
    };

  // `cancelled_by` es lo que distingue «se rajó el cliente» de «cerramos ese
  // día»: sin él, el recuento de cancelaciones tardías le colgaría al cliente
  // las del propio salón. La columna no existe antes de la 0026, así que se
  // manda solo cuando la hay — mismo patrón que el resto del esquema nuevo.
  const { error } = await admin
    .from("bookings")
    .update(
      cancelaciones
        ? { status: "cancelled", cancelled_by: "customer" }
        : { status: "cancelled" }
    )
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

  /**
   * El dueño se entera al momento: un hueco liberado a tiempo se rellena.
   *
   * Y aquí «al momento» es literal — de todos sus avisos, este es el que más
   * depende de la inmediatez: entre cliente y cliente no se mira el correo,
   * pero una notificación sí se ve, y con ella todavía da tiempo a llamar a
   * alguien. Por eso push primero y correo solo si no llegó.
   */
  const { enviarPushDueno } = await import("@/lib/push");
  const alMovil = await enviarPushDueno(b.salons.owner_id, {
    titulo: `Cancelación: ${b.services.name}`,
    cuerpo: `${b.customer_name} · ${fmtWhen(b.starts_at, b.salons.timezone)}. El hueco queda libre.`,
    url: `${(await import("@/lib/urls")).baseUrl()}/admin`,
    tag: `cancel-${b.id}`,
    // Un día: si se pierde, no hay correo detrás.
    ttl: 86400,
  });

  const to = alMovil ? null : await ownerEmail(b.salons.owner_id);
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
    const { enviarPushDueno } = await import("@/lib/push");
    const alMovil = await enviarPushDueno(b.salons.owner_id, {
      titulo: `Valoración de ${rating}/5`,
      cuerpo: `${b.customer_name} · ${b.services.name}. Toca para ver la ficha.`,
      url: `${(await import("@/lib/urls")).baseUrl()}/admin/clientes`,
      tag: `nota-${b.id}`,
    // Un día: si se pierde, no hay correo detrás.
    ttl: 86400,
    });
    const to = alMovil ? null : await ownerEmail(b.salons.owner_id);
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

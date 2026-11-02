import "server-only";
import { sendEmail, cancellationHtml } from "@/lib/email";

/*
 * Los avisos al cliente cuando el salón le mueve o le cancela la cita.
 *
 * Vivían dentro de `moverCita` y `cancelBooking` del panel del dueño. Salen
 * aquí porque desde la 0034 un trabajador con permiso también mueve y
 * cancela, y el cliente tiene que enterarse exactamente igual —mismo canal,
 * mismo texto, misma clave de idempotencia— lo haga quien lo haga.
 *
 * Quien llama ya ha comprobado que la cita es suya (RLS del dueño, o la RPC
 * del trabajador): aquí no se decide nada de permisos.
 */

export type CitaMovida = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_id: string | null;
  public_token?: string;
  services: { name: string };
  salons: { name: string; slug: string; phone: string | null; timezone: string };
};

/** Cita movida: suelta sus recordatorios y avisa al cliente de la hora nueva. */
export async function avisarCitaMovida(cita: CitaMovida, antesIso: string, inicio: string) {
  const id = cita.id;

  /**
   * Los recordatorios ya mandados dejan de valer.
   *
   * Si la cita era mañana y ya se le avisó la víspera, al moverla a la
   * semana que viene ese turno tiene que soltarse: si no, el cliente se
   * queda sin el aviso de su fecha nueva. Borrar la fila es volver a la
   * casilla de salida.
   */
  const { recordatorios } = await (await import("@/lib/features")).features();
  if (recordatorios) {
    // Con service role: la tabla de turnos no tiene políticas a propósito
    // (misma decisión que push_subscriptions), así que la sesión del dueño
    // no la ve.
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    await supabaseAdmin().from("reminders").delete().eq("booking_id", id);
  }

  // Avisar al cliente: mover su cita sin decírselo es plantarle a él.
  const cuando = new Date(inicio).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: cita.salons.timezone,
  });
  const antes = new Date(antesIso).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: cita.salons.timezone,
  });
  const citaUrl = cita.public_token
    ? `${(await import("@/lib/urls")).baseUrl()}/cita/${cita.public_token}`
    : undefined;

  // Push primero, correo si no llegó: la misma escalera que el recordatorio,
  // por la cuota de 100 correos al día.
  let avisado = false;
  if (cita.customer_id) {
    const { enviarPush } = await import("@/lib/push");
    const entregados = await enviarPush(cita.customer_id, {
      titulo: `Tu cita en ${cita.salons.name} ha cambiado de hora`,
      cuerpo: `Ahora es el ${cuando}. Toca para verla.`,
      url: citaUrl ?? `${(await import("@/lib/urls")).baseUrl()}/${cita.salons.slug}`,
      tag: `movida-${id}`,
    });
    avisado = entregados > 0;
  }
  if (!avisado && cita.customer_email) {
    const { bookingMovedHtml } = await import("@/lib/email");
    await sendEmail({
      to: cita.customer_email,
      subject: `Tu cita en ${cita.salons.name} cambia al ${cuando}`,
      html: bookingMovedHtml({
        customerName: cita.customer_name,
        salonName: cita.salons.name,
        salonSlug: cita.salons.slug,
        salonPhone: cita.salons.phone,
        serviceName: cita.services.name,
        antes,
        ahora: cuando,
        citaUrl,
      }),
      // Cada movimiento es un aviso distinto: la clave lleva la hora nueva,
      // porque mover dos veces la misma cita son dos correos legítimos.
      idempotencyKey: `booking-moved/${id}/${inicio}`,
      fromName: cita.salons.name,
    });
  }
}

export type CitaCancelada = {
  customer_name: string;
  customer_email: string | null;
  starts_at: string;
  services: unknown;
  salons: unknown;
};

/** Cita cancelada por el salón: correo al cliente si dejó email. */
export async function avisarCitaCancelada(id: string, b: CitaCancelada) {
  if (!b.customer_email) return;
  const salon = b.salons as { name: string; phone: string | null; timezone: string };
  await sendEmail({
    to: b.customer_email,
    subject: `Tu cita en ${salon.name} se ha cancelado`,
    html: cancellationHtml({
      salonName: salon.name,
      salonPhone: salon.phone,
      serviceName: (b.services as { name: string }).name,
      employeeName: "",
      customerName: b.customer_name,
      when: new Date(b.starts_at).toLocaleString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: salon.timezone,
      }),
    }),
    idempotencyKey: `booking-cancel/${id}`,
  });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Qué decir cuando la base rechaza una cita por solape (`no_overlap`).
 *
 * «Ese profesional ya tiene una cita a esa hora» a secas no bastaba: en el
 * salón piloto el hueco salía vacío en la agenda —la cita que lo ocupaba no
 * estaba cargada— y el dueño no tenía forma de saber con qué chocaba. Ahora
 * se dice quién es y de qué hora a qué hora, que es lo que hace falta para
 * buscarle otro sitio o para darse cuenta de que es la misma persona.
 *
 * El cliente con el que se consulta tiene que poder leer esa cita: la sesión
 * del dueño (RLS lo acota a su salón) o el service role ya filtrado por el
 * salón del trabajador. Si la consulta no encuentra nada —la cita se canceló
 * entre medias—, queda el mensaje de siempre.
 */
export async function mensajeChoque(
  db: SupabaseClient,
  o: {
    salonId: string;
    employeeId: string;
    inicio: string;
    fin: string;
    tz: string;
    /** La cita que se está moviendo: no choca consigo misma. */
    excluir?: string;
  }
): Promise<string> {
  const porDefecto = "Ese profesional ya tiene una cita a esa hora.";

  let q = db
    .from("bookings")
    .select("customer_name, starts_at, ends_at, status")
    .eq("salon_id", o.salonId)
    .eq("employee_id", o.employeeId)
    .neq("status", "cancelled")
    .lt("starts_at", o.fin)
    .gt("ends_at", o.inicio)
    .order("starts_at")
    .limit(1);
  if (o.excluir) q = q.neq("id", o.excluir);

  const { data } = await q.maybeSingle();
  if (!data) return porDefecto;

  const hora = (iso: string) =>
    new Intl.DateTimeFormat("es-ES", {
      timeZone: o.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));
  const tramo = `de ${hora(data.starts_at)} a ${hora(data.ends_at)}`;

  // Una reserva online a medio pagar ocupa el hueco pero no sale en la
  // agenda. Se suelta sola si no se paga: cuando Stripe da el pago por
  // caducado, o a los 40 minutos en cuanto entra otra reserva (0002). No hay
  // un reloj exacto que prometer, así que no se promete.
  if (data.status === "pending_payment")
    return `Ese hueco lo está pagando online un cliente (${tramo}). Si no termina de pagar, se libera solo.`;

  return `Ese hueco ya está cogido: ${data.customer_name}, ${tramo}. Ya te sale en la agenda.`;
}

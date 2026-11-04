import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avisarCitaMovida } from "@/lib/avisos-cita";

export type ResultadoMover =
  | { ok: true }
  | {
      error: string;
      codigo: "invalid" | "no_encontrada" | "inactiva" | "misma_hora" | "solape" | "error";
    };

/**
 * Cambiar una cita de día o de hora desde el lado del salón.
 *
 * Vivía dentro de la server action `moverCita` del panel. La comparten ahora
 * el panel web y la app móvil del dueño (`/api/admin/mover-cita`), para que el
 * aviso al cliente y las reglas sean las mismas entrasen por donde entrasen —
 * como `cancelar-cita.ts`.
 *
 * Aquí se cambia la fila, así que el token del cliente sigue valiendo, su
 * enlace enseña la hora nueva y el .ics se regenera solo.
 *
 * No se valida contra el horario de apertura, igual que al crear a mano: el
 * dueño manda sobre su agenda —una cita a las 21:30 por un favor es asunto
 * suyo—. Lo que sí protege la base es el solape, que no es una opinión.
 *
 * `supabase` es un cliente CON la sesión del dueño (cookie o JWT): RLS decide
 * si la cita es suya. `fecha` es YYYY-MM-DD y `hora` HH:MM, en la zona del salón.
 */
export async function moverCitaDelSalon(
  supabase: SupabaseClient,
  id: string,
  fecha: string,
  hora: string
): Promise<ResultadoMover> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora))
    return { error: "Revisa la fecha y la hora.", codigo: "invalid" };

  // RLS: si la cita no es de un salón suyo, esto no devuelve nada.
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, status, starts_at, customer_name, customer_email, customer_id, public_token, " +
        "services(name, duration_min), salons(name, slug, phone, timezone)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) return { error: "Esa cita no existe.", codigo: "no_encontrada" };

  const cita = b as unknown as {
    id: string; status: string; starts_at: string; customer_name: string;
    customer_email: string | null; customer_id: string | null;
    public_token?: string;
    services: { name: string; duration_min: number };
    salons: { name: string; slug: string; phone: string | null; timezone: string };
  };

  // Mover una cita cancelada o ya cerrada no significa nada: si el cliente
  // vuelve, es una cita nueva.
  if (!["confirmed", "pending_payment"].includes(cita.status))
    return { error: "Solo se pueden mover las citas activas.", codigo: "inactiva" };

  const { zonedTimeUtc } = await import("@/lib/tz");
  const inicio = zonedTimeUtc(fecha, hora, cita.salons.timezone);
  const fin = new Date(
    new Date(inicio).getTime() + cita.services.duration_min * 60000
  ).toISOString();

  if (new Date(inicio).getTime() === new Date(cita.starts_at).getTime())
    return { error: "Esa es la hora que ya tenía.", codigo: "misma_hora" };

  const { error } = await supabase
    .from("bookings")
    .update({ starts_at: inicio, ends_at: fin })
    .eq("id", id);
  if (error) {
    return error.message.includes("no_overlap")
      ? { error: "Ese profesional ya tiene una cita a esa hora.", codigo: "solape" }
      : { error: "No se pudo mover la cita. Inténtalo de nuevo.", codigo: "error" };
  }

  await avisarCitaMovida(cita, cita.starts_at, inicio);
  return { ok: true };
}

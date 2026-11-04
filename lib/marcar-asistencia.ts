import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aplicarFalta, redimirFalta } from "@/lib/penalizaciones";

export const ESTADOS_ASISTENCIA = ["confirmed", "completed", "no_show"] as const;
export type EstadoAsistencia = (typeof ESTADOS_ASISTENCIA)[number];

/**
 * Marca el estado de una cita ya pasada o en curso: atendida, no vino, o
 * deshacerlo (`confirmed`).
 *
 * Vivía dentro de la server action `setBookingStatus`. La comparten ahora el
 * panel web y la app móvil del dueño, porque de este marcado cuelgan la
 * fidelidad, la escalera de faltas y el KPI de no presentados — no puede haber
 * dos versiones.
 *
 * `supabase` es un cliente CON la sesión del dueño: RLS decide si la cita es
 * suya. El `.select()` confirma que dejó tocar la fila: la escalera de faltas
 * va con service role y no debe dispararse con ids de citas ajenas.
 */
export async function marcarAsistenciaDelSalon(
  supabase: SupabaseClient,
  id: string,
  status: string
): Promise<"ok" | "invalid" | "no_encontrada"> {
  if (!(ESTADOS_ASISTENCIA as readonly string[]).includes(status)) return "invalid";

  const { data: tocada } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (!tocada) return "no_encontrada";

  // Escalera de faltas: "no vino" suma falta, "atendida" redime una.
  if (status === "no_show") await aplicarFalta(id);
  else if (status === "completed") await redimirFalta(id);
  return "ok";
}

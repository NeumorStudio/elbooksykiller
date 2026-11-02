"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { aplicarFalta, redimirFalta } from "@/lib/penalizaciones";

/**
 * El trabajador marca si su cliente vino. Lo único que puede escribir.
 *
 * La comprobación de verdad está en la RPC `marcar_mi_cita` (0033): solo
 * sus citas, solo el estado, y «atendida»/«no vino» solo cuando la cita ya
 * ha empezado. Si devuelve true, se aplica la misma escalera de faltas que
 * cuando marca el dueño — `aplicarFalta`/`redimirFalta` van con service role
 * y por eso solo se llaman cuando la RPC ha confirmado que la cita es suya.
 */
export async function marcarMiCita(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["confirmed", "completed", "no_show"].includes(status)) return;

  const { data: ok, error } = await supabase.rpc("marcar_mi_cita", {
    p_booking: id,
    p_status: status,
  });
  if (error || !ok) {
    if (error) console.error("marcarMiCita:", error.message);
    return { error: "No se pudo marcar. Si la cita aún no ha empezado, espera a que empiece." };
  }
  if (status === "no_show") await aplicarFalta(id);
  else if (status === "completed") await redimirFalta(id);
  revalidatePath("/admin/mi-agenda");
}

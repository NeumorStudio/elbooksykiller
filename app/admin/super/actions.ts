"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { esSuperadmin } from "@/lib/superadmin";
import { MODULOS, type Modulo } from "@/lib/modulos";

// Cada action re-comprueba el rol: la página redirige, pero una action es
// un endpoint público y no puede fiarse de quién la llama.
async function exigirSuperadmin() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!esSuperadmin(user?.email)) throw new Error("No autorizado");
}

export async function superBloquear(formData: FormData) {
  await exigirSuperadmin();
  const { error } = await supabaseAdmin()
    .from("salons")
    .update({ blocked: formData.get("blocked") === "1" })
    .eq("id", String(formData.get("id")));
  if (error) return { error: "No se pudo cambiar. ¿Está aplicada la migración 0013?" };
  revalidatePath("/admin/super");
}

export async function superGuardarModulos(formData: FormData) {
  await exigirSuperadmin();
  // Solo se guardan las apagadas: {"productos": false}. Todo activo = NULL,
  // que es también el estado de los salones que nunca se han tocado.
  const apagados: Record<string, boolean> = {};
  for (const m of Object.keys(MODULOS) as Modulo[]) {
    if (formData.get(`mod-${m}`) !== "on") apagados[m] = false;
  }
  const { error } = await supabaseAdmin()
    .from("salons")
    .update({ modules: Object.keys(apagados).length ? apagados : null })
    .eq("id", String(formData.get("id")));
  if (error) return { error: "No se pudo guardar. ¿Está aplicada la migración 0013?" };
  revalidatePath("/admin/super");
}

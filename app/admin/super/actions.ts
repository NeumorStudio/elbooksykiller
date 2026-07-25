"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { esSuperadmin } from "@/lib/superadmin";
import { MODULOS, POR_DEFECTO, type Modulo } from "@/lib/modulos";

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
  // Se guarda solo lo que se aparta del defecto, así que NULL sigue
  // significando "salón sin tocar". Ojo: ahora hay que poder guardar
  // `true` además de `false` — Cobros nace apagado, y encenderlo es
  // exactamente apartarse del defecto.
  const cambios: Record<string, boolean> = {};
  for (const m of Object.keys(MODULOS) as Modulo[]) {
    const activo = formData.get(`mod-${m}`) === "on";
    if (activo !== POR_DEFECTO[m]) cambios[m] = activo;
  }
  const { error } = await supabaseAdmin()
    .from("salons")
    .update({ modules: Object.keys(cambios).length ? cambios : null })
    .eq("id", String(formData.get("id")));
  if (error) return { error: "No se pudo guardar. ¿Está aplicada la migración 0013?" };
  revalidatePath("/admin/super");
}

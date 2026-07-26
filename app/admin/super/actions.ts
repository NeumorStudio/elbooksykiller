"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Entrar en el panel de un salón sin saber su contraseña.
 *
 * Hace falta para dar soporte —cambiar un precio, arreglar un horario— sin
 * que el dueño tenga que compartir su clave. Compartirla sería lo peor de
 * los dos mundos: nosotros custodiando la llave de una cuenta con datos de
 * sus clientes, y él sin poder cambiarla sin avisarnos.
 *
 * Se genera un enlace de acceso de un solo uso con service role y se canjea
 * **aquí mismo**, en el servidor, en vez de redirigir al enlace. Dos razones:
 * el token nunca viaja por la barra de direcciones ni queda en el historial,
 * y no depende de la lista de URLs permitidas de Supabase — que es
 * justamente lo que hoy tiene rotos los magic links de los clientes.
 *
 * Sustituye la sesión del superadmin por la del dueño: para volver a lo
 * tuyo, cierra sesión y entra con tu cuenta.
 */
export async function superEntrarComo(formData: FormData) {
  await exigirSuperadmin();
  const salonId = String(formData.get("id"));

  const admin = supabaseAdmin();
  const { data: salon } = await admin
    .from("salons")
    .select("name, owner_id")
    .eq("id", salonId)
    .maybeSingle();
  if (!salon) return { error: "Salón no encontrado." };

  const { data: dueno } = await admin.auth.admin.getUserById(salon.owner_id);
  const email = dueno?.user?.email;
  if (!email) return { error: "Ese salón no tiene cuenta de acceso." };

  const { data: enlace, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !enlace?.properties?.hashed_token) {
    console.error("superEntrarComo/generateLink:", error?.message);
    return { error: "No se pudo generar el acceso." };
  }

  // Queda constancia de quién entra y en qué salón. Acceder a la cuenta de
  // un cliente es tocar datos personales de terceros: es legítimo como
  // encargado del tratamiento, pero tiene que poder rastrearse.
  const supabase = await supabaseServer();
  const { data: { user: quien } } = await supabase.auth.getUser();
  console.warn(
    `[super] ${quien?.email} entra como "${salon.name}" (${email}) a las ${new Date().toISOString()}`
  );

  const { error: canje } = await supabase.auth.verifyOtp({
    token_hash: enlace.properties.hashed_token,
    type: "magiclink",
  });
  if (canje) {
    console.error("superEntrarComo/verifyOtp:", canje.message);
    return { error: "No se pudo abrir la sesión del salón." };
  }
  redirect("/admin");
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

import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { estadoSalon } from "@/lib/modulos";

/**
 * Sesión del dueño para las server actions del panel.
 *
 * El bloqueo del superadmin se comprobaba solo al pintar el layout: un
 * salón suspendido seguía pudiendo invocar las actions desde el navegador
 * con la sesión que ya tenía (crear citas, mandar newsletters a nuestra
 * costa, conectar dominios). Aquí es donde pasan todas, así que es donde
 * tiene que estar la comprobación.
 */
export async function sesionAdmin() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (salon && (await estadoSalon(salon.id)).blocked) {
    throw new Error("Cuenta bloqueada.");
  }
  return { supabase, user };
}

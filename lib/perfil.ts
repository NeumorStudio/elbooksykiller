import "server-only";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

/**
 * Vincula a la cuenta que ha iniciado sesión sus fichas de cliente.
 *
 * NO es una server action: vive en un módulo server-only y se llama desde
 * el Server Component. Como action era un endpoint público que aceptaba
 * userId y email del llamante y escribía con service role — cualquiera
 * podía reclamar las fichas de otro. La identidad sale siempre de la
 * sesión, nunca de parámetros.
 *
 * El email de la ficha solo se fija en su primera reserva y ya no se puede
 * pisar (migración 0015), así que coincidir con un email verificado por
 * magic link sí es prueba de propiedad.
 */
export async function vincularFichas() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return;

  const emailNorm = user.email.trim().toLowerCase();

  // ilike trata `_` y `%` como comodines: sin escapar, `juan_perez@x.com`
  // reclamaría también las fichas de `juanXperez@x.com`. Seguimos con ilike
  // (no eq) porque el email de customers no se guarda normalizado.
  const patron = emailNorm.replace(/[\\%_]/g, (c) => `\\${c}`);

  const admin = supabaseAdmin();
  // Solo las que no tenga nadie: nunca robar la ficha de otro usuario.
  const { error } = await admin
    .from("customers")
    .update({ auth_user_id: user.id })
    .is("auth_user_id", null)
    .ilike("email", patron);

  // Un choque con unique(salon_id, auth_user_id) aborta el UPDATE entero y
  // deja huérfanas también las fichas de los demás salones. Sin log, el
  // usuario solo ve un perfil vacío.
  if (error) console.error("vincularFichas:", error.message);
}

"use server";

import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

/**
 * Vincula las fichas de cliente del usuario recién logueado.
 *
 * Un cliente puede existir en varios salones (una fila por salón, sin
 * cuenta). Al entrar con su email, reclama todas las fichas con ese email
 * que aún no tienen dueño. Con service role porque la ficha sin vincular
 * todavía no es "suya" a ojos de RLS — es justo lo que se está arreglando.
 */
export async function vincularFichas(userId: string, email: string) {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return;

  // ilike trata `_` y `%` como comodines: sin escapar, `juan_perez@x.com`
  // reclamaría también las fichas de `juanXperez@x.com`. Seguimos con ilike
  // (no eq) porque el email de customers no se guarda normalizado.
  const patron = emailNorm.replace(/[\\%_]/g, (c) => `\\${c}`);

  const admin = supabaseAdmin();
  // Solo las que no tenga nadie: nunca robar la ficha de otro usuario.
  const { error } = await admin
    .from("customers")
    .update({ auth_user_id: userId })
    .is("auth_user_id", null)
    .ilike("email", patron);

  // Un choque con unique(salon_id, auth_user_id) aborta el UPDATE entero y
  // deja huérfanas también las fichas de los demás salones. Sin log, el
  // usuario solo ve un perfil vacío.
  if (error) console.error("vincularFichas:", error.message);
}

export async function cerrarSesion() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

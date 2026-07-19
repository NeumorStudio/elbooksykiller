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

  const admin = supabaseAdmin();
  // Solo las que no tenga nadie: nunca robar la ficha de otro usuario.
  await admin
    .from("customers")
    .update({ auth_user_id: userId })
    .is("auth_user_id", null)
    .ilike("email", emailNorm);
}

export async function cerrarSesion() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

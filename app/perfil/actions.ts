"use server";

import { supabaseServer } from "@/lib/supabase/server";

// vincularFichas vivía aquí. Como server action era un endpoint público que
// aceptaba userId y email del llamante y escribía con service role:
// cualquiera podía reclamar las fichas de otro. Ahora es una función
// server-only en @/lib/perfil que saca la identidad de la sesión.

export async function cerrarSesion() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

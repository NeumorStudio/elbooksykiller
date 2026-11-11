"use server";

import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

// vincularFichas vivía aquí. Como server action era un endpoint público que
// aceptaba userId y email del llamante y escribía con service role:
// cualquiera podía reclamar las fichas de otro. Ahora es una función
// server-only en @/lib/perfil que saca la identidad de la sesión.

/**
 * Pide el enlace de entrada desde el servidor y no desde el navegador:
 * Supabase está detrás de Cloudflare, y los días de partido el cliente no
 * llega a él. El código de verificación queda en una cookie y lo recoge
 * /auth/callback, igual que cuando se pedía desde el navegador.
 */
export async function pedirEnlace(email: string): Promise<{ error: boolean }> {
  const h = await headers();
  const origen = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origen}/auth/callback?next=/perfil` },
  });
  return { error: !!error };
}

// Solo este navegador: sin `scope`, signOut() es global y sacaría al
// cliente también del móvil o de la app. Mismo motivo que `logout()` del panel.
export async function cerrarSesion() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
}

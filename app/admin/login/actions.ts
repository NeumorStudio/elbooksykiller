"use server";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * El login va por el servidor y no desde el navegador: Supabase está detrás de
 * Cloudflare, y con los bloqueos de LaLiga el dueño se quedaba fuera de su
 * panel justo en los días de más citas.
 *
 * Devuelve el mensaje en crudo: la página lo traduce con su tabla de errores.
 */
export async function entrar(email: string, password: string): Promise<{ error?: string }> {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

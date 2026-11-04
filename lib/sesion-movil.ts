import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { estadoSalon } from "@/lib/modulos";

/**
 * Sesión del dueño para los endpoints que llama la app móvil.
 *
 * Es el equivalente de `sesionAdmin` (lib/sesion-admin.ts) para quien no tiene
 * cookies: la app manda el access token de Supabase en `Authorization: Bearer`.
 * El cliente que se devuelve lleva ese mismo token, así que RLS se aplica igual
 * que en el panel web — el endpoint no necesita service role para saber de quién
 * es una cita.
 *
 * Devuelve `null` si el token no vale. Un salón bloqueado por el superadmin
 * tampoco entra: la misma comprobación que `sesionAdmin`, por la misma razón.
 */
export async function sesionMovil(
  req: Request
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return null;

  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (salon && (await estadoSalon(salon.id)).blocked) return null;

  return { supabase, user };
}

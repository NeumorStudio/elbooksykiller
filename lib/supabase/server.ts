// Este módulo guarda la service role key: importarlo desde un componente
// cliente tiene que ser un error de build, no algo que se descubra leyendo
// el bundle. Next borra las env sin NEXT_PUBLIC_ del cliente, pero eso es
// una consecuencia del nombre, no una garantía; esto sí lo es.
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// Cliente con la sesión del usuario (admin panel, RLS aplica)
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // llamado desde un Server Component: el middleware refresca la sesión
          }
        },
      },
    }
  );
}

// Cliente service-role, SOLO servidor. Uso actual: leer la reserva recién
// creada y el email del dueño para las notificaciones.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

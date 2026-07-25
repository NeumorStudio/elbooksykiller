import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Qué partes del esquema nuevo existen ya en la base.
 *
 * El código de app se despliega antes de que el compañero aplique las
 * migraciones (él tiene la contraseña de la BD; esta sesión no). En vez de
 * suponer el esquema, la app lo pregunta: con las tablas ausentes todo se
 * comporta exactamente como hoy, y al aplicar `supabase db push` las
 * funciones se encienden solas. Sin ventana de rotura en ningún orden.
 */
export type Features = {
  clientes: boolean;
  fidelizacion: boolean;
  productos: boolean;
  newsletter: boolean;
  resenas: boolean;
  penalizaciones: boolean;
};

const APAGADO: Features = {
  clientes: false,
  fidelizacion: false,
  productos: false,
  newsletter: false,
  resenas: false,
  penalizaciones: false,
};

// cache() deduplica dentro de la misma petición; entre peticiones vuelve a
// preguntar, que es lo que permite "encenderse" sin redeploy.
export const features = cache(async (): Promise<Features> => {
  try {
    const { data, error } = await supabaseAdmin().rpc("features_disponibles");
    if (error || !data) return APAGADO; // la RPC aún no existe: todo apagado
    return { ...APAGADO, ...(data as Partial<Features>) };
  } catch {
    return APAGADO;
  }
});

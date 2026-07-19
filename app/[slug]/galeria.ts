import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Fotos de trabajos del salón. Viven en el bucket `logos` bajo
 * `galeria/<salon_id>/` — sin columna en la tabla, así que no hay
 * migración que coordinar. El orden alfabético del nombre es el orden en
 * que se muestran.
 *
 * Listar requiere service role (el bucket es público de lectura pero no
 * de listado); esto solo corre en servidor.
 */
export async function fotosDelSalon(salonId: string): Promise<string[]> {
  const admin = supabaseAdmin();
  const carpeta = `galeria/${salonId}`;
  const { data, error } = await admin.storage.from("logos").list(carpeta, {
    limit: 60,
    sortBy: { column: "name", order: "asc" },
  });
  if (error || !data?.length) return [];

  return data
    .filter((f) => f.id) // las carpetas vienen sin id
    .map(
      (f) => admin.storage.from("logos").getPublicUrl(`${carpeta}/${f.name}`).data.publicUrl
    );
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { urlMedia } from "@/lib/media";

/**
 * Foto de cada profesional, para que el cliente sepa con quién reserva.
 *
 * Igual que la galería, SIN columna nueva: viven en el bucket `logos` bajo
 * `equipo/<salon_id>/<employee_id>-<marca de tiempo>.<ext>`. Así no hay
 * migración que coordinar, y la marca de tiempo cambia la URL al cambiar la
 * foto, para que el CDN no siga sirviendo la vieja.
 *
 * Listar requiere service role (el bucket es público de lectura, no de
 * listado): esto solo corre en servidor.
 */
export const carpetaEquipo = (salonId: string) => `equipo/${salonId}`;

/** Un uuid mide 36 caracteres: lo que va delante del guion de la marca. */
export const idDeFichero = (nombre: string) => nombre.slice(0, 36);

/** id del profesional → URL de su foto. Si hay dos, gana la más reciente. */
export async function fotosDelEquipo(salonId: string): Promise<Record<string, string>> {
  const admin = supabaseAdmin();
  const carpeta = carpetaEquipo(salonId);
  const { data, error } = await admin.storage.from("logos").list(carpeta, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });
  if (error || !data?.length) return {};

  const fotos: Record<string, string> = {};
  for (const f of data) {
    if (!f.id) continue; // las carpetas vienen sin id
    // Orden alfabético: a igual id, la marca de tiempo mayor va después y
    // pisa a la anterior.
    fotos[idDeFichero(f.name)] = urlMedia(
      admin.storage.from("logos").getPublicUrl(`${carpeta}/${f.name}`).data.publicUrl
    );
  }
  return fotos;
}

import "server-only";
import { cache } from "react";

/**
 * Qué formas de entrar tiene encendidas el proyecto de Supabase.
 *
 * Se pregunta en vez de darlo por hecho, por la misma razón que features():
 * activar Google o Apple es cosa del panel de Supabase, no del código. Así
 * los botones aparecen solos el día que se enciendan, sin redeploy — y sobre
 * todo, no se enseña un botón que llevaría a un error si están apagados.
 *
 * `/auth/v1/settings` es público y no necesita clave de servicio.
 */
export type Proveedores = { google: boolean; apple: boolean };

const NINGUNO: Proveedores = { google: false, apple: false };

export const proveedoresAuth = cache(async (): Promise<Proveedores> => {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
      {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        // Una hora: esto cambia cuando alguien toca el panel de Supabase, no
        // en cada visita, y no merece una petición por carga de página.
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return NINGUNO;
    const j = (await res.json()) as { external?: Record<string, boolean> };
    return {
      google: !!j.external?.google,
      apple: !!j.external?.apple,
    };
  } catch {
    return NINGUNO;
  }
});

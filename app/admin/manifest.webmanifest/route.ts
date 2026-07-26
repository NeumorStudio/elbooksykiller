import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Manifest del panel: el peluquero se instala su agenda en la tablet.
 *
 * Distinto del manifest de cada salón (/[slug]/manifest.webmanifest), que es
 * la web de reservas para el cliente final. `scope` acota la app instalada a
 * /admin, así que abrir la web pública desde dentro sale al navegador.
 *
 * El slug llega por query (`?s=`) y no de la sesión: **el navegador pide el
 * manifest sin cookies**, así que aquí no hay sesión con la que saber de
 * quién es el panel. Quien sí la tiene es el layout, que construye el enlace
 * con el slug ya puesto.
 *
 * Sin `?s=` sigue respondiendo con el nombre genérico: un manifest no puede
 * romper la instalación por no saber de quién es.
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("s");

  let nombre = "Salonio — mi agenda";
  let corto = "Salonio";
  let iconos = "/admin/pwa-icon";

  if (slug && /^[a-z0-9-]{1,60}$/.test(slug)) {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    const { data: salon } = await anon
      .from("salons")
      .select("name")
      .eq("slug", slug)
      .maybeSingle();
    if (salon) {
      nombre = `Panel Admin ${salon.name}`;
      // Bajo el icono no cabe el salón entero, y lo que hay que distinguir
      // ahí es el panel de la web de reservas — que va instalada al lado y
      // con el mismo logo.
      corto = "Panel Admin";
      // El logo del salón, no el genérico: el dueño reconoce su marca.
      iconos = `/${slug}/pwa-icon`;
    }
  }

  return NextResponse.json(
    {
      name: nombre,
      short_name: corto,
      description: "La agenda de tu peluquería",
      id: "/admin",
      start_url: "/admin",
      scope: "/admin",
      display: "standalone",
      background_color: "#222325",
      theme_color: "#222325",
      icons: [192, 512].map((size) => ({
        src: `${iconos}?size=${size}`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any maskable",
      })),
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        // Caché corta: el nombre depende del salón, y un logo nuevo tiene
        // que aparecer sin esperar una hora.
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}

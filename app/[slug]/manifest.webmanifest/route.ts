import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Manifest PWA por salón: la app instalada se llama como la peluquería.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
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
  if (!salon) return new NextResponse(null, { status: 404 });

  /**
   * `name` es lo que sale en el diálogo de «Añadir a pantalla de inicio», y
   * ahí un nombre a secas no dice qué es: entre veinte iconos, «Paye
   * Villalobos» puede ser cualquier cosa. Se le pone delante lo que es.
   *
   * Solo si no lo dice ya: «Barbería Paco» no necesita que le llamemos
   * peluquería, y ponérselo sería llamarle otra cosa de la que es.
   */
  const yaSeSabe = /(peluquer|barber|sal[oó]n|estilis|estudio)/i.test(salon.name);
  const nombre = yaSeSabe ? salon.name : `Peluquería ${salon.name}`;

  return NextResponse.json(
    {
      name: nombre,
      // Antes se cortaba a 12 caracteres a mano y quedaba «Paye Villalo»:
      // un nombre partido a mitad de palabra parece un error de la app. El
      // recorte bajo el icono lo hace el sistema, y lo hace con puntos
      // suspensivos — que se entiende. Aquí va el nombre entero.
      short_name: salon.name,
      description: `Reserva tu cita en ${salon.name}`,
      id: `/${slug}`,
      start_url: `/${slug}`,
      scope: `/${slug}`,
      display: "standalone",
      background_color: "#1b1712",
      theme_color: "#1b1712",
      icons: [192, 512].map((size) => ({
        src: `/${slug}/pwa-icon?size=${size}`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any maskable",
      })),
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

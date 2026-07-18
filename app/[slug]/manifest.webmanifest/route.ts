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

  return NextResponse.json(
    {
      name: salon.name,
      short_name: salon.name.length > 12 ? salon.name.slice(0, 12) : salon.name,
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

import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

// Icono PWA por salón: inicial en oro sobre el fondo noche de la marca.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const size = Math.min(1024, Math.max(64, Number(new URL(req.url).searchParams.get("size")) || 512));

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: salon } = await anon
    .from("salons")
    .select("name, logo_url")
    .eq("slug", slug)
    .maybeSingle();
  const letter = (salon?.name ?? "•").trim().charAt(0).toUpperCase();

  if (salon?.logo_url && !salon.logo_url.includes(".svg")) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1b1712",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={salon.logo_url}
            alt=""
            width={size * 0.72}
            height={size * 0.72}
            style={{ objectFit: "contain" }}
          />
        </div>
      ),
      { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } }
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1b1712",
          color: "#e5b356",
          fontSize: size * 0.58,
          fontWeight: 700,
          fontFamily: "serif",
        }}
      >
        {letter}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=86400" },
    }
  );
}

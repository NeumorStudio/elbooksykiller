import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// El icono se genera con next/og (Satori), que NO decodifica WebP — y los
// logos se guardan en WebP. Por eso el logo salía en blanco (solo el fondo).
// Aquí bajamos el logo y lo convertimos a PNG con sharp antes de incrustarlo,
// así el icono de "añadir a inicio" muestra la marca de verdad.
export const runtime = "nodejs";

/**
 * `max-age` a secas solo cachea en el navegador: el CDN no guardaba nada y
 * cada visitante nuevo ejecutaba esta función dos veces —Chrome pide el
 * icono de 192 y el de 512 al comprobar si la PWA es instalable—, y cada
 * ejecución es consulta a Supabase + descarga del logo + sharp + Satori.
 * Con tres salones da igual; es lo que no aguanta al crecer, y ya nos costó
 * la cuota de funciones una vez (ver el comentario del tamaño, más abajo).
 *
 * `s-maxage` mete el CDN de por medio. Un día de desfase es asumible: si un
 * salón cambia de logo, el icono ya instalado en los móviles no cambia de
 * todas formas —el sistema lo congela al instalar la app— así que refrescar
 * antes no arreglaría nada.
 */
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * El logo solo se descarga si vive en nuestro Storage.
 *
 * `uploadLogo` valida lo que sube el dueño, pero RLS le deja escribir
 * `logo_url` directamente por REST con su propio token: podía apuntarlo a
 * cualquier URL y hacer que el servidor la pidiera (SSRF a la red interna)
 * y metiera esos bytes en el decodificador de imágenes.
 */
function esDeNuestroStorage(url: string): boolean {
  try {
    const u = new URL(url);
    const nuestro = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return u.protocol === "https:" && u.host === nuestro.host;
  } catch {
    return false;
  }
}

// Icono PWA por salón: el logo sobre el fondo noche de la marca.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Solo los tamaños que pide el manifest. Con el rango 64–1024 libre había
  // 961 claves de caché distintas, cada una con descarga + sharp + Satori:
  // un bucle de curl agotaba la cuota de funciones.
  // 32 es el de la pestaña del navegador; los otros tres, los del manifest.
  const pedido = Number(new URL(req.url).searchParams.get("size"));
  const size = [32, 180, 192, 512].includes(pedido) ? pedido : 512;

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

  // Logo → PNG (sharp acepta webp/png/jpeg/svg). Si algo falla, cae a la
  // inicial en oro; el icono nunca debe romper la instalación de la PWA.
  let logoPng: string | null = null;
  if (salon?.logo_url && esDeNuestroStorage(salon.logo_url)) {
    try {
      const res = await fetch(salon.logo_url, { cache: "no-store" });
      if (res.ok) {
        const input = Buffer.from(await res.arrayBuffer());
        const box = Math.round(size * 0.72);
        const png = await sharp(input)
          .resize(box, box, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
        logoPng = `data:image/png;base64,${png.toString("base64")}`;
      }
    } catch {
      logoPng = null;
    }
  }

  if (logoPng) {
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
            src={logoPng}
            alt=""
            width={size * 0.72}
            height={size * 0.72}
            style={{ objectFit: "contain" }}
          />
        </div>
      ),
      { width: size, height: size, headers: { "Cache-Control": CACHE } }
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
      headers: { "Cache-Control": CACHE },
    }
  );
}

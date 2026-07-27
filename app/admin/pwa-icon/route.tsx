import { ImageResponse } from "next/og";
import { MARCA } from "./marca";

// Icono del panel instalado: la marca de Salonio sobre el fondo del taller.
// Sin base de datos — el navegador pide los iconos sin cookies, y además el
// panel es el mismo para todos los dueños.
export const runtime = "nodejs";

// utf8 y no base64: el SVG se lee tal cual en marca.ts y pesa un tercio menos.
const MARCA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(MARCA)}`;

export function GET(req: Request) {
  // Solo los tamaños del manifest y el de iOS: cada tamaño distinto es una
  // clave de caché y una imagen que generar.
  const pedido = Number(new URL(req.url).searchParams.get("size"));
  const size = [180, 192, 512].includes(pedido) ? pedido : 512;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#222325",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARCA_URI} width={size} height={size} alt="" />
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=86400" },
    }
  );
}

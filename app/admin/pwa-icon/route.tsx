import { ImageResponse } from "next/og";

// Icono del panel instalado: la S de Salonio en dorado sobre el fondo del
// taller. Sin base de datos — el navegador pide los iconos sin cookies, y
// además el panel es el mismo para todos los dueños.
export const runtime = "nodejs";

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
          alignItems: "center",
          justifyContent: "center",
          background: "#222325",
          color: "#e0b76c",
          fontSize: size * 0.58,
          fontWeight: 700,
          fontFamily: "serif",
        }}
      >
        S
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=86400" },
    }
  );
}

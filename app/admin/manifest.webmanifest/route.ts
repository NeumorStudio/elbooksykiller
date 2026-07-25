import { NextResponse } from "next/server";

// Manifest del panel: el peluquero se instala su agenda en la tablet.
//
// Distinto del manifest de cada salón (/[slug]/manifest.webmanifest), que es
// la web de reservas para el cliente final. `scope` acota la app instalada a
// /admin, así que abrir la web pública desde dentro sale al navegador.
//
// Sin datos del salón a propósito: el navegador pide el manifest SIN cookies,
// así que aquí no hay sesión con la que saber de quién es el panel.
export function GET() {
  return NextResponse.json(
    {
      name: "Salonio — mi agenda",
      short_name: "Salonio",
      description: "La agenda de tu peluquería",
      id: "/admin",
      start_url: "/admin",
      scope: "/admin",
      display: "standalone",
      background_color: "#222325",
      theme_color: "#222325",
      icons: [192, 512].map((size) => ({
        src: `/admin/pwa-icon?size=${size}`,
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

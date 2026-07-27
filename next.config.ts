import type { NextConfig } from "next";

/**
 * Interruptor de base de datos para desarrollo: `BD=dev` o `BD=prod` en
 * .env.local y ya. Copia el juego de credenciales elegido sobre los nombres
 * que usa la app, así que nada más en el código sabe que existen dos.
 *
 * En Vercel no hay BD ni SUPABASE_*_URL: no toca nada y manda lo que haya
 * configurado en el proyecto. Vive aquí porque las NEXT_PUBLIC_* se
 * incrustan en el bundle al arrancar, y next.config es lo primero que corre.
 */
function elegirBD() {
  const bd = (process.env.BD ?? "").toLowerCase();
  if (bd !== "dev" && bd !== "prod") return;
  const pre = `SUPABASE_${bd.toUpperCase()}_`;
  const url = process.env[`${pre}URL`];
  const anon = process.env[`${pre}ANON_KEY`];
  const service = process.env[`${pre}SERVICE_ROLE_KEY`];
  if (!url || !anon || !service) {
    console.warn(`⚠ BD=${bd} pero faltan ${pre}URL/ANON_KEY/SERVICE_ROLE_KEY en .env.local`);
    return;
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  process.env.SUPABASE_SERVICE_ROLE_KEY = service;
  console.log(
    bd === "prod"
      ? "🔴 BD=prod — estás escribiendo en la base de PRODUCCIÓN (clientes reales)"
      : "🟢 BD=dev — base de pruebas"
  );
}
elegirBD();

// Referrer-Policy es la que más urge: las páginas con token en la URL
// (/cita/[token], /baja/[token]) enlazan a Google Calendar y Maps, y con la
// política por defecto el token viajaba en la cabecera Referer a terceros.
// Sin CSP todavía: el panel usa estilos y scripts en línea de Next, y una
// CSP mal puesta rompe la app entera. Va después del lanzamiento, medida.
const CABECERAS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }, // subida de logos
  },
  /**
   * Sin esto no hay PWA instalable en Android.
   *
   * Next, en páginas dinámicas, no espera a `generateMetadata`: emite la
   * metadata más tarde, en el cuerpo, y React la sube al <head> ya en
   * cliente. Para `/[slug]` eso incluye el <link rel="manifest">, que
   * llegaba unos 9 KB después de cerrar el <head>.
   *
   * Chrome decide si la web es instalable mientras carga la página. Al no
   * ver manifest usaba los valores por defecto —scope la raíz, sin
   * `display: standalone`, sin iconos—, la daba por no instalable y no
   * disparaba `beforeinstallprompt`. El banner de instalación no salía en
   * Android por esto, no por el service worker. En iPhone sí salía porque
   * iOS no usa ese evento.
   *
   * Un patrón que casa con todo es lo que documenta Next para desactivar
   * el streaming de metadata del todo: trata cada petición como la de un
   * bot que necesita la metadata en el <head>. Cuesta que el <head> ahora
   * espera a la consulta del salón; la página ya la esperaba para pintarse.
   */
  htmlLimitedBots: /.*/,
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS }];
  },
};

export default nextConfig;

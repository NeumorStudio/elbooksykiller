/**
 * Fotos del Storage de Supabase, servidas por nuestro propio dominio.
 *
 * El Storage está detrás de Cloudflare, y los días de partido los operadores
 * cortan esas IPs por los bloqueos de LaLiga: el logo y la galería salían
 * rotos. `/media/*` lo reenvía Vercel (ver `rewrites` en next.config.ts), así
 * que el navegador del cliente no llega a tocar Cloudflare.
 *
 * Solo cambia lo que se pinta. En la base sigue la URL original, porque de
 * ella dependen `esDeNuestroStorage` y el borrado de ficheros.
 */
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;

export function urlMedia(url: string): string {
  return url.startsWith(BASE) ? `/media/${url.slice(BASE.length)}` : url;
}

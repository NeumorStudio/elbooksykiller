import "server-only";

/**
 * URL base de la plataforma para enlaces en emails que salen de un cron,
 * donde no hay `headers()` de los que deducir el host.
 *
 * /cita/[token] y /baja/[token] son rutas de plataforma (el token es global,
 * no depende del salón), así que no hace falta el dominio propio del salón.
 */
export function baseUrl(): string {
  if (process.env.PLATFORM_URL) return process.env.PLATFORM_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  // Cuidado: en local esto acaba dentro de emails REALES si .env.local apunta
  // a la base de producción, y el cliente recibe un enlace muerto. Que se vea.
  console.warn(
    "[urls] baseUrl() cae a localhost: define PLATFORM_URL. " +
      "Los enlaces de emails enviados desde aquí no funcionarán fuera de esta máquina."
  );
  return "http://localhost:3000";
}

#!/usr/bin/env node
/**
 * Copia de seguridad de los datos de producción.
 *
 * Supabase Free **no hace copias**: el PITR es de pago. Hoy hay citas y
 * fichas de clientes reales de una peluquería que confía en esto, y no hay
 * red debajo. Esto es la red.
 *
 * Vuelca solo DATOS, no esquema, y es a propósito: el esquema vive en
 * supabase/migrations y se reconstruye con `supabase db push`. Migraciones +
 * este volcado = base entera.
 *
 * Sin dependencias nuevas: habla con PostgREST por `fetch`, que Node ya trae.
 * Añadir `pg` al proyecto para un script que se ejecuta una vez al día no
 * compensa, y así corre igual en cualquier máquina o en un cron.
 *
 *   node scripts/backup.mjs [carpeta-destino]
 *
 * Lee SUPABASE_URL/SERVICE_ROLE del entorno; si no están, de .env.local.
 *
 * ⚠️ Lo que NO entra: las cuentas de `auth.users` (los logins de los dueños
 * de salón), que viven en un esquema al que la API no llega. Al restaurar
 * hay que volver a crearlas y reapuntar `salons.owner_id`. Son tres o cuatro
 * cuentas; los datos de clientes, que son los irreemplazables, sí van.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGINA = 1000;

function delEntorno(clave) {
  if (process.env[clave]) return process.env[clave];
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return env.match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

const URL_BASE = delEntorno("NEXT_PUBLIC_SUPABASE_URL");
const CLAVE = delEntorno("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_BASE || !CLAVE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const cab = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };

/**
 * Las tablas se descubren, no se listan a mano: una migración nueva que
 * añada una tabla entraría sola en la copia. Una lista fija se queda vieja
 * en silencio, que es la peor forma de que falle un backup.
 */
async function tablas() {
  const res = await fetch(`${URL_BASE}/rest/v1/`, { headers: cab });
  if (!res.ok) throw new Error(`No se pudo listar tablas: HTTP ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.definitions ?? {}).sort();
}

async function volcar(tabla) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const res = await fetch(
      `${URL_BASE}/rest/v1/${tabla}?select=*&limit=${PAGINA}&offset=${desde}`,
      { headers: cab }
    );
    if (!res.ok) throw new Error(`${tabla}: HTTP ${res.status} ${await res.text()}`);
    const lote = await res.json();
    filas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return filas;
}

const destino = process.argv[2] ?? "copias";
// Sin ':' en el nombre: Windows no lo admite en rutas.
const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const carpeta = join(destino, sello);
mkdirSync(carpeta, { recursive: true });

const resumen = {};
let total = 0;
let fallos = 0;

for (const tabla of await tablas()) {
  try {
    const filas = await volcar(tabla);
    writeFileSync(join(carpeta, `${tabla}.json`), JSON.stringify(filas, null, 1));
    resumen[tabla] = filas.length;
    total += filas.length;
    console.log(`  ${tabla.padEnd(24)} ${filas.length}`);
  } catch (e) {
    resumen[tabla] = `ERROR: ${e.message}`;
    fallos++;
    console.error(`  ${tabla.padEnd(24)} ✗ ${e.message}`);
  }
}

writeFileSync(
  join(carpeta, "_manifiesto.json"),
  JSON.stringify(
    {
      fecha: new Date().toISOString(),
      proyecto: URL_BASE.replace("https://", "").replace(".supabase.co", ""),
      tablas: resumen,
      filas: total,
      // Que quede escrito dentro de la propia copia, no solo en un README
      // que nadie abre el día que hay que restaurar.
      nota: "Solo datos. El esquema se reconstruye con supabase db push. auth.users NO está incluido.",
    },
    null,
    2
  )
);

console.log(`\n${total} filas en ${carpeta}`);
if (fallos) {
  console.error(`${fallos} tabla(s) fallaron: la copia está incompleta.`);
  process.exit(1);
}

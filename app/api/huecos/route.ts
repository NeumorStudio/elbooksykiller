import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Horas libres de un profesional en un día.
 *
 * Existe por los bloqueos de LaLiga. Supabase está detrás de Cloudflare, y los
 * días de partido los operadores cortan esas IPs: la web cargaba (va por
 * Vercel), pero el selector de horas hablaba con Supabase desde el navegador
 * del cliente y se quedaba sin huecos. Desde aquí la llamada sale de Vercel,
 * que no está bloqueado.
 *
 * Usa la clave pública a propósito: son las mismas RPC y los mismos permisos
 * que tenía el navegador, nada más.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SERVICIOS = 10;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const empleado = q.get("empleado") ?? "";
  const dia = q.get("dia") ?? "";
  const servicios = (q.get("servicios") ?? "").split(",").filter(Boolean);

  const valido =
    UUID.test(empleado) &&
    DIA.test(dia) &&
    servicios.length > 0 &&
    servicios.length <= MAX_SERVICIOS &&
    servicios.every((s) => UUID.test(s));
  if (!valido) {
    return NextResponse.json({ error: "Parámetros no válidos." }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  // Con acompañantes hacen falta los huecos donde cabe el bloque entero, no
  // donde cabe el primer corte: de eso se encarga la RPC combinada.
  const { data, error } =
    servicios.length > 1
      ? await sb.rpc("available_slots_combo", {
          p_employee: empleado,
          p_services: servicios,
          p_day: dia,
        })
      : await sb.rpc("available_slots", {
          p_employee: empleado,
          p_service: servicios[0],
          p_day: dia,
        });

  if (error) {
    console.error("huecos:", error.message);
    return NextResponse.json({ error: "No se pudo consultar." }, { status: 502 });
  }

  // Sin caché: una hora que acaba de reservar otro no puede seguir saliendo libre.
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}

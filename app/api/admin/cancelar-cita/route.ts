import { NextResponse } from "next/server";
import { sesionMovil } from "@/lib/sesion-movil";
import { cancelarCitaDelSalon } from "@/lib/cancelar-cita";

/**
 * Cancelar una cita desde la app móvil del dueño.
 *
 * Mismo efecto que el botón del panel (`cancelBooking`): comparten
 * `cancelarCitaDelSalon`, así que el reembolso y el aviso al cliente no se
 * pueden desviar entre las dos entradas. Autentica con el JWT del dueño
 * (`Authorization: Bearer`); RLS limita la cita a su salón.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const sesion = await sesionMovil(req);
  if (!sesion) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await cancelarCitaDelSalon(sesion.supabase, id);
  if (r === "no_encontrada") return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
  if (r === "error") return NextResponse.json({ error: "error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

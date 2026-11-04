import { NextResponse } from "next/server";
import { sesionMovil } from "@/lib/sesion-movil";
import { moverCitaDelSalon } from "@/lib/mover-cita";

/**
 * Mover una cita de día u hora desde la app móvil del dueño.
 *
 * Comparte `moverCitaDelSalon` con el panel (`moverCita`): mismas reglas, mismo
 * aviso al cliente. Autentica con el JWT del dueño; RLS limita la cita a su
 * salón. `fecha` YYYY-MM-DD y `hora` HH:MM, en la zona horaria del salón.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO = { invalid: 400, no_encontrada: 404, inactiva: 409, misma_hora: 409, solape: 409, error: 500 } as const;

export async function POST(req: Request) {
  const sesion = await sesionMovil(req);
  if (!sesion) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; fecha?: unknown; hora?: unknown }
    | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const fecha = typeof body?.fecha === "string" ? body.fecha : "";
  const hora = typeof body?.hora === "string" ? body.hora : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await moverCitaDelSalon(sesion.supabase, id, fecha, hora);
  if ("ok" in r) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: r.codigo, mensaje: r.error }, { status: ESTADO[r.codigo] });
}

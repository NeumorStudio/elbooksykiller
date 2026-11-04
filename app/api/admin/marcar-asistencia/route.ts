import { NextResponse } from "next/server";
import { sesionMovil } from "@/lib/sesion-movil";
import { marcarAsistenciaDelSalon } from "@/lib/marcar-asistencia";

/**
 * Marcar asistencia (atendida / no vino / deshacer) desde la app móvil del dueño.
 *
 * Comparte `marcarAsistenciaDelSalon` con el panel (`setBookingStatus`): la
 * escalera de faltas y la redención son las mismas entrasen por donde entrasen.
 * Autentica con el JWT del dueño; RLS limita la cita a su salón.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const sesion = await sesionMovil(req);
  if (!sesion) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await marcarAsistenciaDelSalon(sesion.supabase, id, status);
  if (r === "invalid") return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (r === "no_encontrada") return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

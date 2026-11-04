import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifyBookingConfirmed } from "@/lib/notifications";

/**
 * Aviso al dueño de una reserva hecha desde la app móvil.
 *
 * La app reserva con `create_booking_v2` y la clave anónima, igual que el
 * widget de la web, pero allí el aviso lo manda la server action. Aquí la app
 * llama a este endpoint con el `public_token` de la cita que acaba de crear.
 *
 * Seguridad: el token solo lo tiene quien reservó, y `reclamar_aviso_reserva`
 * (0035) solo lo acepta una vez, en los 10 minutos siguientes a crear la cita.
 * Si no cuadra, la respuesta es la misma que si todo hubiera ido bien: no se
 * le cuenta a nadie qué tokens existen.
 *
 * Corre en Vercel Hobby: una invocación corta por reserva, sin trabajo extra.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!UUID.test(token)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: bookingId, error } = await supabaseAdmin().rpc("reclamar_aviso_reserva", {
    p_token: token,
  });
  if (error) {
    // Lo normal aquí es que la 0035 aún no esté aplicada en esa base.
    console.error("[avisar] reclamar_aviso_reserva", error.message);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!bookingId) return NextResponse.json({ ok: true });

  // Nunca lanza: un correo caído no debe romper nada.
  await notifyBookingConfirmed(bookingId as string);
  return NextResponse.json({ ok: true });
}

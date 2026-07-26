import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendEmail, faltaHtml } from "@/lib/email";
import { enviarPush } from "@/lib/push";
import { baseUrl } from "@/lib/urls";

/**
 * Escalera de faltas por no presentarse.
 *
 * Se engancha al marcado de citas del dueño: "no vino" suma una falta y
 * aplica el castigo que toque según el programa del salón; "atendida" limpia
 * una falta y relaja el castigo (redención: quien vuelve y cumple se
 * rehabilita solo). Todo en try/catch: antes de la migración 0014 las
 * columnas no existen y marcar citas debe seguir funcionando exactamente
 * igual — mismo patrón que features().
 */

type Programa = { active: boolean; block_after: number; block_days: number; ban_after: number };

async function contexto(bookingId: string) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("bookings")
    .select("customer_id, salon_id, customer_name, customer_email, salons(name, slug, phone, timezone)")
    .eq("id", bookingId)
    .maybeSingle();
  const b = data as unknown as {
    customer_id: string | null;
    salon_id: string;
    customer_name: string;
    customer_email: string | null;
    salons: { name: string; slug: string; phone: string | null; timezone: string };
  } | null;
  if (!b?.customer_id) return null; // walk-in sin ficha: no hay a quién sancionar
  const { data: prog } = await admin
    .from("penalty_programs")
    .select("active, block_after, block_days, ban_after")
    .eq("salon_id", b.salon_id)
    .maybeSingle();
  if (!prog) return null;
  return { admin, b, prog: prog as Programa };
}

export async function aplicarFalta(bookingId: string) {
  try {
    const ctx = await contexto(bookingId);
    if (!ctx || !ctx.prog.active) return;
    const { admin, b, prog } = ctx;

    const { data: c } = await admin
      .from("customers")
      .select("no_show_strikes")
      .eq("id", b.customer_id!)
      .maybeSingle();
    if (!c) return;

    const faltas = c.no_show_strikes + 1;
    const cambio: Record<string, unknown> = { no_show_strikes: faltas };
    let nivel: "aviso" | "bloqueo" | "veto" = "aviso";
    let hasta: string | undefined;
    if (faltas >= prog.ban_after) {
      cambio.banned = true;
      nivel = "veto";
    } else if (faltas >= prog.block_after) {
      const fin = new Date(Date.now() + prog.block_days * 86400000);
      cambio.blocked_until = fin.toISOString();
      nivel = "bloqueo";
      hasta = fin.toLocaleDateString("es-ES", {
        day: "numeric", month: "long", timeZone: b.salons.timezone,
      });
    }
    await admin.from("customers").update(cambio).eq("id", b.customer_id!);

    /**
     * El aviso al cliente, push primero.
     *
     * Este es el aviso que más importa que se lea: le dice que ha perdido
     * la reserva online y cómo recuperarla. Enterrado en el correo, el
     * cliente se encuentra el bloqueo semanas después al intentar reservar
     * y no entiende nada — y ahí ya lo has perdido.
     */
    const avisoPush = await enviarPush(b.customer_id!, {
      titulo:
        nivel === "aviso"
          ? `Tu cita en ${b.salons.name} quedó sin asistir`
          : `Tu reserva online en ${b.salons.name} está pausada`,
      cuerpo:
        nivel === "aviso"
          ? "Si se repite, la reserva por internet se bloquea. Toca para verlo."
          : hasta
            ? `Puedes volver a reservar el ${hasta}. Toca para verlo.`
            : "Llámanos y lo arreglamos. Toca para ver el teléfono.",
      url: `${baseUrl()}/${b.salons.slug}`,
      icono: `${baseUrl()}/${b.salons.slug}/pwa-icon?size=192`,
      tag: `falta-${bookingId}`,
    });

    // Si el push llegó no se manda el correo: avisar dos veces de una
    // sanción se lee como insistencia. idempotencyKey: re-marcar la misma
    // cita no re-avisa.
    if (!avisoPush && b.customer_email) {
      await sendEmail({
        to: b.customer_email,
        subject:
          nivel === "aviso"
            ? `Tu cita en ${b.salons.name} quedó sin asistir`
            : `Tu reserva online en ${b.salons.name} está pausada`,
        html: faltaHtml({
          customerName: b.customer_name,
          salonName: b.salons.name,
          salonSlug: b.salons.slug,
          salonPhone: b.salons.phone,
          nivel,
          hasta,
        }),
        idempotencyKey: `falta-${bookingId}`,
        fromName: b.salons.name,
      });
    }
  } catch {}
}

export async function redimirFalta(bookingId: string) {
  try {
    const ctx = await contexto(bookingId);
    if (!ctx) return;
    const { admin, b, prog } = ctx;

    const { data: c } = await admin
      .from("customers")
      .select("no_show_strikes, blocked_until, banned")
      .eq("id", b.customer_id!)
      .maybeSingle();
    if (!c || (c.no_show_strikes === 0 && !c.banned && !c.blocked_until)) return;

    const faltas = Math.max(0, c.no_show_strikes - 1);
    const cambio: Record<string, unknown> = { no_show_strikes: faltas };
    if (faltas < prog.ban_after) cambio.banned = false;
    if (faltas < prog.block_after) cambio.blocked_until = null;
    await admin.from("customers").update(cambio).eq("id", b.customer_id!);
  } catch {}
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { sendEmail, resenaHtml } from "@/lib/email";
import { baseUrl } from "@/lib/urls";

/**
 * Petición de valoración unas horas después del servicio.
 *
 * La nota es privada (1-5, para el salón); el enlace de Google se ofrece
 * después de valorar y A TODOS por igual — el review gating está prohibido
 * y puede costarle la ficha al salón.
 *
 * Idempotencia por reclamo: se INSERTA la fila en review_requests (con
 * booking_id UNIQUE) antes de enviar. Si el insert choca, otro tick ya lo
 * reclamó y se salta. Así un cron solapado no manda el correo dos veces.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Fila = {
  id: string;
  ends_at: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  public_token: string;
  salon_id: string;
  salons: { name: string; timezone: string } | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin secreto configurado se cierra: fallar en abierto dejaba el cron
  // invocable por cualquiera (envíos masivos, citas marcadas solas).
  if (!secret) return new NextResponse("cron sin configurar", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("no autorizado", { status: 401 });
  }

  const f = await features();
  if (!f.resenas || !f.clientes) return NextResponse.json({ apagado: true });

  const admin = supabaseAdmin();
  const ahora = Date.now();

  // Completadas hace entre 2 y 24 horas. La ventana ancha tolera ticks
  // perdidos; el reclamo en review_requests evita duplicados.
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, ends_at, customer_id, customer_name, customer_email, public_token, salon_id, salons(name, timezone)"
    )
    .eq("status", "completed")
    .lt("ends_at", new Date(ahora - 2 * 3600_000).toISOString())
    .gte("ends_at", new Date(ahora - 24 * 3600_000).toISOString())
    .not("customer_email", "is", null);

  if (error) {
    console.error("[resenas] consulta fallida:", error.message);
    return NextResponse.json({ error: "consulta fallida" }, { status: 500 });
  }

  const citas = (data ?? []) as unknown as Fila[];
  let enviados = 0;
  let omitidos = 0;

  for (const c of citas) {
    if (!c.salons || !c.customer_email) {
      omitidos++;
      continue;
    }

    // Ventana de silencio: nada entre las 22:00 y las 9:00 del salón.
    const horaLocal = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: c.salons.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date())
    );
    if (horaLocal >= 22 || horaLocal < 9) {
      omitidos++;
      continue;
    }

    // Reclamo: si ya existe la fila (enviada o valorada), aquí termina.
    const { error: claim } = await admin.from("review_requests").insert({
      booking_id: c.id,
      customer_id: c.customer_id,
      salon_id: c.salon_id,
      sent_at: new Date().toISOString(),
    });
    if (claim) {
      omitidos++;
      continue;
    }

    // La tarjeta en el mismo correo: mejor motor de retorno que cualquier
    // incentivo — y legal.
    let sellos: { tiene: number; requiere: number; premio: string } | null = null;
    if (f.fidelizacion && c.customer_id) {
      const { data: prog } = await admin
        .from("loyalty_programs")
        .select("active, required_visits, reward")
        .eq("salon_id", c.salon_id)
        .maybeSingle();
      if (prog?.active) {
        const { count } = await admin
          .from("loyalty_stamps")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", c.customer_id)
          .is("redemption_id", null);
        sellos = { tiene: count ?? 0, requiere: prog.required_visits, premio: prog.reward };
      }
    }

    await sendEmail({
      to: c.customer_email,
      subject: `¿Qué tal fue tu visita a ${c.salons.name}?`,
      html: resenaHtml({
        salonName: c.salons.name,
        customerName: c.customer_name,
        citaUrl: `${baseUrl()}/cita/${c.public_token}`,
        sellos,
      }),
      idempotencyKey: `review-request/${c.id}`,
    });
    enviados++;
  }

  return NextResponse.json({ candidatos: citas.length, enviados, omitidos });
}

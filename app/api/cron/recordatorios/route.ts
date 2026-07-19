import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendEmail, reminderHtml } from "@/lib/email";
import { features } from "@/lib/features";
import { baseUrl } from "@/lib/urls";

/**
 * Recordatorio de cita ~24 h antes.
 *
 * Es el hueco competitivo frente a GoBarber, que sí los tiene. La evidencia
 * seria (metaanálisis de 10 ECAs, y el estudio del Parc Sanitari Sant Joan
 * de Déu que bajó el absentismo del 19,7% al 12,5%) da una reducción
 * relativa del 20-35%, no del 80% que promete el marketing del sector.
 *
 * Sobre la zona horaria: NO hay que convertir nada para decidir a quién
 * avisar. `starts_at` es timestamptz, o sea un instante absoluto, y "24
 * horas antes" es aritmética de instantes. La zona del salón solo importa
 * para redactar el texto.
 *
 * Idempotencia: sin tabla `reminders` (haría falta una migración que no
 * puedo ejecutar), se apoya en el `idempotencyKey` de Resend — el mismo
 * patrón que ya usa lib/notifications.ts. Su ventana de deduplicación es
 * de 24 h, que cubre justo este caso. Cuando exista la tabla, moverlo allí:
 * un `unique (booking_id, kind)` es una garantía de base de datos y esto
 * solo es una garantía de proveedor.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Fila = {
  id: string;
  starts_at: string;
  customer_name: string;
  customer_email: string | null;
  public_token?: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
  salons: { name: string; phone: string | null; address: string | null; timezone: string } | null;
};

export async function GET(req: Request) {
  // Vercel Cron firma sus peticiones; nadie más debe poder dispararlo.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("no autorizado", { status: 401 });
  }

  const admin = supabaseAdmin();
  const ahora = Date.now();
  // public_token solo existe tras la migración 0006; pedirlo antes rompería
  // la consulta entera.
  const { clientes } = await features();
  // Ventana amplia (23-25 h) para que un tick perdido no deje a nadie sin
  // aviso; la deduplicación evita el envío doble en los solapes.
  const desde = new Date(ahora + 23 * 3600_000).toISOString();
  const hasta = new Date(ahora + 25 * 3600_000).toISOString();

  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, starts_at, customer_name, customer_email" +
        (clientes ? ", public_token" : "") +
        ", services(name, price_cents), employees(name), salons(name, phone, address, timezone)"
    )
    .gte("starts_at", desde)
    .lt("starts_at", hasta)
    .eq("status", "confirmed")
    .not("customer_email", "is", null);

  if (error) {
    console.error("[recordatorios] consulta fallida:", error.message);
    return NextResponse.json({ error: "consulta fallida" }, { status: 500 });
  }

  const citas = (data ?? []) as unknown as Fila[];
  let enviados = 0;
  let omitidos = 0;

  for (const c of citas) {
    const salon = c.salons;
    if (!salon || !c.customer_email) {
      omitidos++;
      continue;
    }

    // Ventana de silencio: nada entre las 22:00 y las 9:00 hora del salón.
    // Aquí sí hace falta la zona horaria — es la única decisión que depende
    // del reloj de pared.
    const horaLocal = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: salon.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date())
    );
    if (horaLocal >= 22 || horaLocal < 9) {
      omitidos++;
      continue;
    }

    const cuando = new Date(c.starts_at).toLocaleString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: salon.timezone,
    });

    await sendEmail({
      to: c.customer_email,
      subject: `Mañana: tu cita en ${salon.name}`,
      html: reminderHtml({
        salonName: salon.name,
        salonPhone: salon.phone,
        salonAddress: salon.address,
        serviceName: c.services?.name ?? "tu cita",
        employeeName: c.employees?.name ?? "",
        customerName: c.customer_name,
        when: cuando,
        price: ((c.services?.price_cents ?? 0) / 100).toLocaleString("es-ES", {
          style: "currency",
          currency: "EUR",
        }),
        citaUrl: c.public_token ? `${baseUrl()}/cita/${c.public_token}` : undefined,
      }),
      idempotencyKey: `booking-reminder/${c.id}`,
    });
    enviados++;
  }

  return NextResponse.json({ candidatos: citas.length, enviados, omitidos });
}

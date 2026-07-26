import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendEmail, reminderHtml } from "@/lib/email";
import { features } from "@/lib/features";
import { baseUrl } from "@/lib/urls";
import { enviarPush } from "@/lib/push";

/**
 * Recordatorio de cita ~1 h antes.
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
  created_at: string;
  customer_name: string;
  customer_email: string | null;
  customer_id: string | null;
  public_token?: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
  salons: {
    name: string; slug: string; phone: string | null;
    address: string | null; timezone: string;
  } | null;
};

export async function GET(req: Request) {
  // Vercel Cron firma sus peticiones; nadie más debe poder dispararlo.
  const secret = process.env.CRON_SECRET;
  // Sin secreto configurado se cierra: fallar en abierto dejaba el cron
  // invocable por cualquiera (envíos masivos, citas marcadas solas).
  if (!secret) return new NextResponse("cron sin configurar", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("no autorizado", { status: 401 });
  }

  const admin = supabaseAdmin();
  const ahora = Date.now();
  // public_token solo existe tras la migración 0006; pedirlo antes rompería
  // la consulta entera.
  const { clientes } = await features();
  // Recordatorio ~1 h antes. Ventana 50-70 min para que un tick perdido (el
  // cron corre cada ~10 min) no deje a nadie sin aviso; la deduplicación
  // evita el envío doble en los solapes.
  const desde = new Date(ahora + 50 * 60_000).toISOString();
  const hasta = new Date(ahora + 70 * 60_000).toISOString();

  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, starts_at, created_at, customer_name, customer_email, customer_id" +
        (clientes ? ", public_token" : "") +
        ", services(name, price_cents), employees(name), salons(name, slug, phone, address, timezone)"
    )
    .gte("starts_at", desde)
    .lt("starts_at", hasta)
    // Ya no se filtra por customer_email: un cliente puede tener el aviso
    // push activado y no haber dejado correo, y filtrarlo aquí lo dejaba
    // fuera del recordatorio sin que nadie lo notara.
    .eq("status", "confirmed");

  if (error) {
    console.error("[recordatorios] consulta fallida:", error.message);
    return NextResponse.json({ error: "consulta fallida" }, { status: 500 });
  }

  const citas = (data ?? []) as unknown as Fila[];
  let enviados = 0;
  let porPush = 0;
  let omitidos = 0;

  for (const c of citas) {
    const salon = c.salons;
    if (!salon) {
      omitidos++;
      continue;
    }

    // Regla: si reservó con menos de 1 h de antelación, no se le recuerda —
    // acaba de recibir la confirmación y el aviso sobraría o llegaría tarde.
    if (
      new Date(c.created_at).getTime() >
      new Date(c.starts_at).getTime() - 60 * 60_000
    ) {
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

    const citaUrl = c.public_token ? `${baseUrl()}/cita/${c.public_token}` : undefined;

    /**
     * Push primero, y si llega, no se manda el correo.
     *
     * No es solo evitar avisar dos veces de lo mismo: el plan gratuito de
     * Resend son 100 emails al DÍA, y el recordatorio es el envío más
     * repetitivo que hay. Cada cliente que activa el aviso en el móvil
     * libera cuota para lo que sí necesita correo.
     *
     * Si el push falla —móvil apagado, endpoint caducado— se cae al email,
     * que es justo lo que tiene que pasar: el aviso importa más que el
     * canal.
     */
    if (c.customer_id) {
      const entregados = await enviarPush(c.customer_id, {
        titulo: `Tu cita en ${salon.name} es en 1 hora`,
        cuerpo: `${c.services?.name ?? "Tu cita"}${c.employees?.name ? ` con ${c.employees.name}` : ""} · ${new Date(
          c.starts_at
        ).toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: salon.timezone,
        })}`,
        url: citaUrl ?? `${baseUrl()}/${salon.slug}`,
        icono: `${baseUrl()}/${salon.slug}/pwa-icon?size=192`,
        tag: `cita-${c.id}`,
      });
      if (entregados > 0) {
        porPush++;
        continue;
      }
    }

    if (!c.customer_email) {
      omitidos++;
      continue;
    }

    await sendEmail({
      to: c.customer_email,
      subject: `En 1 hora: tu cita en ${salon.name}`,
      html: reminderHtml({
        salonName: salon.name,
        salonSlug: salon.slug,
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
        citaUrl,
      }),
      idempotencyKey: `booking-reminder/${c.id}`,
      // El recordatorio llega una hora antes: que se vea de quién es.
      fromName: salon.name,
    });
    enviados++;
  }

  return NextResponse.json({ candidatos: citas.length, enviados, porPush, omitidos });
}

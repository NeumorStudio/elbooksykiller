import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendEmail, reminderHtml } from "@/lib/email";
import { features } from "@/lib/features";
import { sePuedeCancelar } from "@/lib/cancelacion";
import { baseUrl } from "@/lib/urls";
import { enviarPush } from "@/lib/push";

/**
 * Recordatorios de cita: la víspera y una hora antes.
 *
 * El de 1 h es el hueco competitivo frente a GoBarber, que sí los tiene. La
 * evidencia seria (metaanálisis de 10 ECAs, y el estudio del Parc Sanitari
 * Sant Joan de Déu que bajó el absentismo del 19,7% al 12,5%) da una
 * reducción relativa del 20-35%, no del 80% que promete el marketing del
 * sector.
 *
 * El de la víspera se añadió después, y no es más de lo mismo: el de 1 h
 * llega cuando ya no queda margen para nada —el cliente lee que no llega y
 * ni siquiera puede cancelar—, mientras que un aviso 24 h antes le da la
 * oportunidad de soltar la cita cuando el hueco todavía se puede vender.
 * Ese es el objetivo real: no recordar, sino liberar a tiempo.
 *
 * Sobre la zona horaria: NO hay que convertir nada para decidir a quién
 * avisar. `starts_at` es timestamptz, o sea un instante absoluto, y "24
 * horas antes" es aritmética de instantes. La zona del salón solo importa
 * para redactar el texto.
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

/**
 * Los dos avisos.
 *
 * Las ventanas son más anchas que el intervalo del cron (~10 min) para que
 * un tick perdido no deje a nadie sin recordatorio; que eso no se convierta
 * en avisos repetidos es cosa de la tabla `reminders`.
 *
 * `minAntelacionMin` descarta a quien reservó ya dentro del plazo: acaba de
 * recibir la confirmación y el recordatorio sobraría.
 */
const AVISOS = [
  {
    kind: "vispera" as const,
    desdeMin: 23 * 60 + 50,
    hastaMin: 24 * 60 + 10,
    minAntelacionMin: 24 * 60,
    asunto: (salon: string) => `Mañana: tu cita en ${salon}`,
    pushTitulo: (salon: string) => `Mañana tienes cita en ${salon}`,
  },
  {
    kind: "hora" as const,
    desdeMin: 50,
    hastaMin: 70,
    minAntelacionMin: 60,
    asunto: (salon: string) => `En 1 hora: tu cita en ${salon}`,
    pushTitulo: (salon: string) => `Tu cita en ${salon} es en 1 hora`,
  },
];

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
  // la consulta entera. `recordatorios` es la tabla de turnos de la 0027:
  // sin ella se manda como se mandaba, apoyándose solo en Resend.
  const { clientes, recordatorios } = await features();

  /**
   * Pide el turno para avisar de esta cita.
   *
   * Insertar es la operación que decide: si la fila ya estaba, este tick no
   * envía. Es atómico, así que dos ejecuciones a la vez no pueden enviar las
   * dos. Sin la tabla se devuelve `true` y manda el comportamiento de antes.
   */
  const tomarTurno = async (bookingId: string, kind: string) => {
    if (!recordatorios) return true;
    const { data, error } = await admin
      .from("reminders")
      .upsert({ booking_id: bookingId, kind }, { onConflict: "booking_id,kind", ignoreDuplicates: true })
      .select("booking_id");
    // Un fallo de la tabla no debe dejar a nadie sin recordatorio: se avisa
    // igual y como mucho se repite, que es el mal menor.
    if (error) {
      console.error("[recordatorios] turno:", error.message);
      return true;
    }
    return (data?.length ?? 0) > 0;
  };

  const total = { enviados: 0, porPush: 0, omitidos: 0, repetidos: 0, yaAvisados: 0 };

  for (const aviso of AVISOS) {
    const desde = new Date(ahora + aviso.desdeMin * 60_000).toISOString();
    const hasta = new Date(ahora + aviso.hastaMin * 60_000).toISOString();

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
      console.error(`[recordatorios/${aviso.kind}] consulta fallida:`, error.message);
      return NextResponse.json({ error: "consulta fallida" }, { status: 500 });
    }

    for (const c of (data ?? []) as unknown as Fila[]) {
      const salon = c.salons;
      if (!salon) {
        total.omitidos++;
        continue;
      }

      // Quien reservó ya dentro del plazo del aviso no lo necesita.
      if (
        new Date(c.created_at).getTime() >
        new Date(c.starts_at).getTime() - aviso.minAntelacionMin * 60_000
      ) {
        total.omitidos++;
        continue;
      }

      if (!(await tomarTurno(c.id, aviso.kind))) {
        total.repetidos++;
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
      const hora = new Date(c.starts_at).toLocaleTimeString("es-ES", {
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
       * repetitivo que hay — ahora el doble, con dos avisos por cita. Cada
       * cliente que activa el aviso en el móvil libera cuota para lo que sí
       * necesita correo.
       *
       * Si el push falla —móvil apagado, endpoint caducado— se cae al email,
       * que es justo lo que tiene que pasar: el aviso importa más que el
       * canal.
       */
      if (c.customer_id) {
        const entregados = await enviarPush(c.customer_id, {
          titulo: aviso.pushTitulo(salon.name),
          cuerpo: `${c.services?.name ?? "Tu cita"}${c.employees?.name ? ` con ${c.employees.name}` : ""} · ${hora}`,
          url: citaUrl ?? `${baseUrl()}/${salon.slug}`,
          icono: `${baseUrl()}/${salon.slug}/pwa-icon?size=192`,
          tag: `cita-${c.id}-${aviso.kind}`,
        });
        if (entregados > 0) {
          total.porPush++;
          continue;
        }
      }

      if (!c.customer_email) {
        total.omitidos++;
        continue;
      }

      /**
       * El de 1 h no gasta correo si ya se avisó la víspera.
       *
       * Un correo que llega sesenta minutos antes casi no se lee: nadie mira
       * la bandeja de entrada camino del trabajo, y a esa hora ni siquiera
       * queda margen para cancelar. Si ayer se le avisó, este correo es ruido
       * caro — el plan de Resend son 100 al día y se comparte.
       *
       * Ojo con lo que NO hace: el push de arriba se manda igual, porque una
       * notificación a una hora sí se ve y es gratis. Y quien reservó hoy
       * mismo no recibió víspera, así que para él este correo es su único
       * aviso y sale como siempre.
       */
      if (aviso.kind === "hora" && recordatorios) {
        const { data: ayer } = await admin
          .from("reminders")
          .select("booking_id")
          .eq("booking_id", c.id)
          .eq("kind", "vispera")
          .maybeSingle();
        if (ayer) {
          total.yaAvisados++;
          continue;
        }
      }

      await sendEmail({
        to: c.customer_email,
        subject: aviso.asunto(salon.name),
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
          // El de 1 h sale entre 50 y 70 min antes y el margen para cancelar
          // es de 1 h: dentro de la misma tanda hay citas que aún se pueden
          // cancelar y citas que ya no. El botón lo dice por cada una.
          puedeCancelar: sePuedeCancelar(c.starts_at),
          vispera: aviso.kind === "vispera",
        }),
        idempotencyKey: `booking-reminder-${aviso.kind}/${c.id}`,
        // El recordatorio llega de parte del salón: que se vea de quién es.
        fromName: salon.name,
      });
      total.enviados++;
    }
  }

  return NextResponse.json(total);
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  sendEmail,
  customerConfirmationHtml,
  ownerNotificationHtml,
  type BookingEmailData,
} from "@/lib/email";

const fmtWhen = (iso: string, tz: string) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });

// Emails de una reserva confirmada. Idempotente por booking (clave Resend),
// así puede llamarse desde el webhook y desde la verificación al volver del
// pago sin duplicar. Nunca lanza: un email caído no rompe nada.
export async function notifyBookingConfirmed(bookingId: string) {
  try {
    const admin = supabaseAdmin();
    // public_token solo existe tras la migración 0006; pedirlo antes haría
    // fallar el select entero (y con él, todos los emails).
    const { clientes } = await (await import("@/lib/features")).features();
    const { data } = await admin
      .from("bookings")
      .select(
        "starts_at, customer_name, customer_phone, customer_email, services(name, price_cents), employees(name), salons(name, phone, timezone, owner_id)" +
          (clientes ? ", public_token" : "")
      )
      .eq("id", bookingId)
      .single();
    // La select dinámica impide la inferencia de tipos de supabase-js.
    const b = data as unknown as {
      starts_at: string;
      customer_name: string;
      customer_phone: string;
      customer_email: string | null;
      services: unknown;
      employees: unknown;
      salons: unknown;
      public_token?: string;
    } | null;
    if (!b) return;

    const salon = b.salons as unknown as {
      name: string; phone: string | null; timezone: string; owner_id: string;
    };
    const d: BookingEmailData = {
      salonName: salon.name,
      salonPhone: salon.phone,
      serviceName: (b.services as unknown as { name: string }).name,
      employeeName: (b.employees as unknown as { name: string }).name,
      when: fmtWhen(b.starts_at, salon.timezone),
      price: ((b.services as unknown as { price_cents: number }).price_cents / 100).toLocaleString(
        "es-ES",
        { style: "currency", currency: "EUR" }
      ),
      customerName: b.customer_name,
      customerPhone: b.customer_phone,
      citaUrl: b.public_token
        ? `${(await import("@/lib/urls")).baseUrl()}/cita/${b.public_token}`
        : undefined,
    };

    const sends: Promise<void>[] = [];
    if (b.customer_email) {
      sends.push(
        sendEmail({
          to: b.customer_email,
          subject: `Cita confirmada en ${d.salonName}`,
          html: customerConfirmationHtml(d),
          idempotencyKey: `booking-confirm/${bookingId}`,
        })
      );
    }
    const { data: ownerRes } = await admin.auth.admin.getUserById(salon.owner_id);
    if (ownerRes?.user?.email) {
      sends.push(
        sendEmail({
          to: ownerRes.user.email,
          subject: `Nueva reserva: ${d.serviceName} — ${d.when}`,
          html: ownerNotificationHtml(d),
          idempotencyKey: `booking-owner/${bookingId}`,
        })
      );
    }
    await Promise.all(sends);
  } catch (e) {
    console.error("[email] error notificando reserva", bookingId, e);
  }
}

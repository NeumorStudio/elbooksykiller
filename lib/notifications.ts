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
    const { data: b } = await admin
      .from("bookings")
      .select(
        "starts_at, customer_name, customer_phone, customer_email, services(name, price_cents), employees(name), salons(name, phone, timezone, owner_id)"
      )
      .eq("id", bookingId)
      .single();
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

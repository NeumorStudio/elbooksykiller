"use server";

import { createClient } from "@supabase/supabase-js";
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

export async function bookAppointment(input: {
  employeeId: string;
  serviceId: string;
  startIso: string;
  name: string;
  phone: string;
  email: string;
}): Promise<{ ok: true } | { error: "slot_unavailable" | "invalid" }> {
  // La validación real vive en la RPC create_booking (security definer):
  // horario, ausencias, solapes, futuro. Aquí solo se transporta.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: bookingId, error } = await anon.rpc("create_booking", {
    p_employee: input.employeeId,
    p_service: input.serviceId,
    p_start: input.startIso,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email || null,
  });

  if (error) {
    return { error: error.message.includes("slot_unavailable") ? "slot_unavailable" : "invalid" };
  }

  // Emails después de reservar; si fallan, la reserva sigue en pie.
  try {
    const admin = supabaseAdmin();
    const { data: b } = await admin
      .from("bookings")
      .select(
        "starts_at, customer_name, customer_phone, customer_email, services(name, price_cents), employees(name), salons(name, phone, timezone, owner_id)"
      )
      .eq("id", bookingId)
      .single();
    if (!b) return { ok: true };

    const salon = b.salons as unknown as { name: string; phone: string | null; timezone: string; owner_id: string };
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

  return { ok: true };
}

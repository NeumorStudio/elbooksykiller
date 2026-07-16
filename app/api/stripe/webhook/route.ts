import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifyBookingConfirmed } from "@/lib/notifications";

export async function POST(req: Request) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;
      if (bookingId && session.payment_status === "paid") {
        const { data } = await admin
          .from("bookings")
          .update({ status: "confirmed", payment_status: "paid" })
          .eq("id", bookingId)
          .eq("status", "pending_payment")
          .select("id")
          .maybeSingle();
        if (data) await notifyBookingConfirmed(bookingId);
      }
      break;
    }
    case "checkout.session.expired": {
      const bookingId = event.data.object.metadata?.booking_id;
      if (bookingId) {
        await admin
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("id", bookingId)
          .eq("status", "pending_payment");
      }
      break;
    }
    case "account.updated": {
      const account = event.data.object;
      await admin
        .from("salons")
        .update({ charges_enabled: account.charges_enabled ?? false })
        .eq("stripe_account_id", account.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

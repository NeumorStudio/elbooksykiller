import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sendEmail } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import { sincronizarSuscripcion } from "@/lib/suscripcion";

/**
 * Webhook de las cuotas que pagan los salones.
 *
 * Es otro endpoint y otro secreto que /api/stripe/webhook a propósito. Aquel
 * escucha las cuentas conectadas (los cobros de cada salón a sus clientes), y
 * este la cuenta de NeumorStudio. Separados, un fallo aquí no toca las reservas.
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const firma = req.headers.get("stripe-signature");
  if (!firma) return NextResponse.json({ error: "falta la firma" }, { status: 400 });

  let evento: Stripe.Event;
  try {
    evento = stripe.webhooks.constructEvent(
      payload,
      firma,
      process.env.STRIPE_WEBHOOK_SECRET_SUSCRIPCIONES!
    );
  } catch {
    return NextResponse.json({ error: "firma no válida" }, { status: 400 });
  }

  try {
    switch (evento.type) {
      case "checkout.session.completed": {
        const sesion = evento.data.object;
        if (sesion.mode === "subscription" && typeof sesion.subscription === "string") {
          await sincronizarSuscripcion(sesion.subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await sincronizarSuscripcion(evento.data.object.id);
        break;
      case "invoice.payment_failed": {
        const detalle = evento.data.object.parent?.subscription_details?.subscription;
        const id = typeof detalle === "string" ? detalle : detalle?.id;
        if (id) {
          const fila = await sincronizarSuscripcion(id);
          await avisarImpago(evento, fila?.salon_id);
        }
        break;
      }
    }
  } catch (e) {
    // 500 a propósito: Stripe reintenta durante días.
    console.error("webhook de suscripciones:", e);
    return NextResponse.json({ error: "no procesado" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Stripe avisa al cliente por su cuenta. Esto es para que lo sepamos nosotros. */
async function avisarImpago(evento: Stripe.Event, salonId: string | undefined) {
  const destinos = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  await Promise.all(
    destinos.map((to) =>
      sendEmail({
        to,
        subject: "Salonio: pago de cuota fallido",
        html: `<p>Ha fallado el cobro de la cuota del salón <b>${salonId ?? "desconocido"}</b>.</p>
               <p>Stripe lo reintentará solo. Míralo en <a href="https://dashboard.stripe.com">su panel</a>.</p>`,
        idempotencyKey: `impago-${evento.id}-${to}`,
      })
    )
  );
}

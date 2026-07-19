import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { sendEmail, newsletterHtml } from "@/lib/email";
import { baseUrl } from "@/lib/urls";

/**
 * Envío de newsletters por tandas.
 *
 * El panel encola (campaña en 'sending' + filas 'queued'); este cron
 * procesa. Un envío de 300 destinatarios no cabe en una petición: cada
 * tick despacha una tanda y el siguiente continúa donde quedó. La
 * unique(campaign_id, customer_id) y el idempotencyKey de Resend hacen que
 * un tick solapado no duplique a nadie.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TANDA = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("no autorizado", { status: 401 });
  }

  const f = await features();
  if (!f.newsletter) return NextResponse.json({ apagado: true });

  const admin = supabaseAdmin();

  const { data: campanas } = await admin
    .from("newsletter_campaigns")
    .select("id, subject, body, salons(name)")
    .eq("status", "sending")
    .limit(3);
  if (!campanas?.length) return NextResponse.json({ pendientes: 0 });

  let enviados = 0;

  for (const camp of campanas) {
    const salonName =
      (camp as unknown as { salons: { name: string } | null }).salons?.name ?? "";

    const { data: cola } = await admin
      .from("newsletter_sends")
      .select("id, email, customer_id, customers(baja_token)")
      .eq("campaign_id", camp.id)
      .eq("status", "queued")
      .limit(TANDA);

    if (!cola?.length) {
      // Cola vacía: la campaña terminó.
      await admin
        .from("newsletter_campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", camp.id)
        .eq("status", "sending");
      continue;
    }

    for (const s of cola) {
      const bajaToken = (s as unknown as { customers: { baja_token: string } | null })
        .customers?.baja_token;

      await sendEmail({
        to: s.email,
        subject: camp.subject,
        html: newsletterHtml({
          salonName,
          body: camp.body,
          bajaUrl: bajaToken ? `${baseUrl()}/baja/${bajaToken}` : baseUrl(),
        }),
        idempotencyKey: `newsletter/${camp.id}/${s.customer_id}`,
      });

      await admin
        .from("newsletter_sends")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", s.id)
        .eq("status", "queued");
      enviados++;
    }
  }

  return NextResponse.json({ campanas: campanas.length, enviados });
}

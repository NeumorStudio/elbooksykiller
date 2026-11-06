"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sesionAdmin } from "@/lib/sesion-admin";
import { stripe } from "@/lib/stripe";
import { claveAlta, claveCuota, estaViva, planPorId } from "@/lib/planes";

async function origen() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** El salón del dueño y su suscripción, si tiene. */
async function salonYSuscripcion() {
  const { supabase, user } = await sesionAdmin();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) redirect("/admin");
  const { data: suscripcion } = await supabase
    .from("suscripciones")
    .select("estado, stripe_customer_id")
    .eq("salon_id", salon.id)
    .maybeSingle();
  return { salon, suscripcion, user };
}

async function abrirPortal(customer: string): Promise<never> {
  const sesion = await stripe.billingPortal.sessions.create({
    customer,
    return_url: `${await origen()}/admin/plan`,
    locale: "es",
  });
  redirect(sesion.url);
}

export async function contratarPlan(formData: FormData) {
  const plan = planPorId(String(formData.get("plan") ?? ""));
  if (!plan) redirect("/admin/plan");

  const { salon, suscripcion, user } = await salonYSuscripcion();

  // Con una suscripción viva no se abre otra: se cambia desde el portal.
  if (suscripcion && estaViva(suscripcion.estado)) await abrirPortal(suscripcion.stripe_customer_id);

  // Sin el IVA o sin los precios en Stripe no se cobra nada: mejor no vender
  // que cobrar un importe equivocado.
  const iva = process.env.STRIPE_IVA_ID;
  const { data: precios } = await stripe.prices.list({
    lookup_keys: [claveCuota(plan.id), claveAlta(plan.id)],
    active: true,
  });
  const cuota = precios.find((p) => p.lookup_key === claveCuota(plan.id));
  const alta = precios.find((p) => p.lookup_key === claveAlta(plan.id));
  if (!iva || !cuota || !alta) {
    console.error("planes sin configurar en Stripe: falta el IVA o algún precio");
    redirect("/admin/plan?error=config");
  }

  const base = await origen();
  const cliente = suscripcion?.stripe_customer_id;
  const sesion = await stripe.checkout.sessions.create({
    mode: "subscription",
    locale: "es",
    client_reference_id: salon.id,
    ...(cliente
      ? { customer: cliente, customer_update: { name: "auto", address: "auto" } }
      : { customer_email: user.email ?? undefined }),
    line_items: [
      { price: cuota.id, quantity: 1, tax_rates: [iva] },
      { price: alta.id, quantity: 1, tax_rates: [iva] },
    ],
    payment_method_types: ["card", "sepa_debit"],
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    // Para el precio fundador: un cupón creado en Stripe y su código.
    allow_promotion_codes: true,
    subscription_data: { metadata: { salon_id: salon.id, plan: plan.id } },
    success_url: `${base}/admin/plan?hecho=1`,
    cancel_url: `${base}/admin/plan`,
  });
  redirect(sesion.url!);
}

export async function gestionarPlan() {
  const { suscripcion } = await salonYSuscripcion();
  if (!suscripcion) redirect("/admin/plan");
  await abrirPortal(suscripcion.stripe_customer_id);
}

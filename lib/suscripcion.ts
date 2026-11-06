import "server-only";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import { estaViva, planDeClave } from "@/lib/planes";

/**
 * Copia en la base lo que Stripe dice ahora de una suscripción.
 *
 * Se pregunta a Stripe en vez de fiarse del evento porque los webhooks pueden
 * llegar desordenados: así un aviso viejo no pisa un estado nuevo.
 *
 * Lanza si no puede guardar, para que el webhook responda 500 y Stripe reintente.
 */
export async function sincronizarSuscripcion(id: string) {
  const sub = await stripe.subscriptions.retrieve(id);
  const salonId = sub.metadata.salon_id;
  const item = sub.items.data[0];
  const plan = planDeClave(item?.price.lookup_key) ?? sub.metadata.plan;
  if (!salonId || !plan) {
    // No es nuestra, o la crearon a mano sin metadatos: reintentar no lo arregla.
    console.error(`suscripción ${id} sin salón o sin plan`);
    return null;
  }

  const admin = supabaseAdmin();

  // El aviso de baja de una suscripción vieja no puede tapar a la que la sustituyó.
  const { data: actual } = await admin
    .from("suscripciones")
    .select("stripe_subscription_id, estado")
    .eq("salon_id", salonId)
    .maybeSingle();
  if (actual && actual.stripe_subscription_id !== id && estaViva(actual.estado) && !estaViva(sub.status)) {
    return null;
  }

  const fila = {
    salon_id: salonId,
    plan,
    estado: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: id,
    periodo_fin: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancela_al_final: sub.cancel_at_period_end,
    actualizada_en: new Date().toISOString(),
  };
  const { error } = await admin.from("suscripciones").upsert(fila, { onConflict: "salon_id" });
  if (error) throw new Error(`no se pudo guardar la suscripción: ${error.message}`);
  return fila;
}

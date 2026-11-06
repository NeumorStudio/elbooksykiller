#!/usr/bin/env node
/**
 * Crea en Stripe los planes de lib/planes.json y el IVA, y dice qué variable poner.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-planes.mjs
 *
 * Se puede repetir sin miedo: lo que ya existe se deja como está.
 *
 * ⚠️ Escribe en la cuenta de Stripe de la clave que le pases. Con una clave real
 * exige --produccion, para que no se lance por error.
 *
 * Un precio de Stripe no se puede cambiar. Si tocas un importe en planes.json,
 * el script lo detecta y mueve la clave a un precio nuevo: las suscripciones
 * que ya existen siguen con el precio antiguo.
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const clave = process.env.STRIPE_SECRET_KEY;
if (!clave) {
  console.error("Falta STRIPE_SECRET_KEY.");
  process.exit(1);
}
if (clave.startsWith("sk_live") && !process.argv.includes("--produccion")) {
  console.error("Es una clave real. Si es lo que quieres, añade --produccion.");
  process.exit(1);
}

const stripe = new Stripe(clave);
const planes = JSON.parse(readFileSync(new URL("../lib/planes.json", import.meta.url), "utf8"));

async function asegurarPrecio({ lookup_key, unit_amount, recurring, product, nickname }) {
  const { data } = await stripe.prices.list({ lookup_keys: [lookup_key], active: true });
  if (data[0]?.unit_amount === unit_amount) {
    console.log(`  ya existe  ${lookup_key}`);
    return;
  }
  await stripe.prices.create({
    currency: "eur",
    product,
    nickname,
    unit_amount,
    lookup_key,
    transfer_lookup_key: true,
    tax_behavior: "exclusive",
    ...(recurring ? { recurring } : {}),
  });
  console.log(`  creado     ${lookup_key} (${unit_amount / 100} €)`);
}

// Con list y no con search: search tarda en ver lo recién creado, y repetir el
// script justo después duplicaría los productos.
const { data: productos } = await stripe.products.list({ active: true, limit: 100 });

for (const plan of planes) {
  console.log(plan.nombre);
  const producto =
    productos.find((p) => p.metadata.plan === plan.id) ??
    (await stripe.products.create({ name: `Salonio ${plan.nombre}`, metadata: { plan: plan.id } }));
  await asegurarPrecio({
    lookup_key: `salonio_${plan.id}_mensual`,
    unit_amount: plan.cuotaCent,
    recurring: { interval: "month" },
    product: producto.id,
    nickname: `${plan.nombre}, cuota`,
  });
  await asegurarPrecio({
    lookup_key: `salonio_${plan.id}_alta`,
    unit_amount: plan.altaCent,
    product: producto.id,
    nickname: `${plan.nombre}, alta`,
  });
}

const { data: tasas } = await stripe.taxRates.list({ active: true, limit: 100 });
const iva =
  tasas.find((t) => t.percentage === 21 && t.country === "ES" && !t.inclusive) ??
  (await stripe.taxRates.create({
    display_name: "IVA",
    percentage: 21,
    inclusive: false,
    country: "ES",
    jurisdiction: "ES",
    tax_type: "vat",
  }));

console.log(`\nPon esta variable en Vercel:\n\nSTRIPE_IVA_ID=${iva.id}\n`);

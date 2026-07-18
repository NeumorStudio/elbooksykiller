import Stripe from "stripe";

// Lazy: no instanciar en build (falla si STRIPE_SECRET_KEY no existe aún)
let client: Stripe | null = null;
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
    return Reflect.get(client, prop);
  },
});

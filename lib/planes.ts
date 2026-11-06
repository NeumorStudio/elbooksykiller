import datos from "./planes.json";

/**
 * Los planes que un salón paga a NeumorStudio.
 *
 * Los importes viven en planes.json porque también los lee
 * scripts/stripe-planes.mjs, que crea los precios en Stripe. Lo que se cobra
 * de verdad es lo que hay en Stripe: si cambias un importe aquí, hay que volver
 * a lanzar ese script. Todos los importes son sin IVA.
 */
export type Plan = {
  id: string;
  nombre: string;
  cuotaCent: number;
  altaCent: number;
  incluye: string[];
  pronto: string[];
};

export const PLANES: Plan[] = datos;

export const planPorId = (id: string) => PLANES.find((p) => p.id === id);

// Los precios se buscan en Stripe por esta clave: así no hace falta una
// variable de entorno por cada precio, ni distinguir modo prueba y real.
export const claveCuota = (id: string) => `salonio_${id}_mensual`;
export const claveAlta = (id: string) => `salonio_${id}_alta`;

/** Cambiar de plan desde el portal de Stripe cambia el precio: de ahí sale el plan. */
export function planDeClave(clave: string | null | undefined): string | null {
  return PLANES.find((p) => claveCuota(p.id) === clave)?.id ?? null;
}

/** El salón tiene una suscripción viva, y no debe poder contratar otra. */
export function estaViva(estado: string | null | undefined): boolean {
  return ["active", "trialing", "past_due", "unpaid", "paused"].includes(estado ?? "");
}

export const ESTADOS: Record<string, string> = {
  active: "Activa",
  trialing: "En prueba",
  past_due: "Pago pendiente",
  unpaid: "Impagada",
  paused: "En pausa",
  canceled: "Cancelada",
  incomplete: "Pago sin completar",
  incomplete_expired: "Pago caducado",
};

export const euros = (cent: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cent % 100 ? 2 : 0,
  }).format(cent / 100);

import Link from "next/link";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { connectStripe } from "../actions";
import Ayuda from "../ayuda";

export default async function PaymentsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, stripe_account_id, charges_enabled")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  // Al volver del onboarding, refrescar el estado desde Stripe
  let chargesEnabled = salon.charges_enabled;
  if (salon.stripe_account_id) {
    try {
      const account = await stripe.accounts.retrieve(salon.stripe_account_id);
      chargesEnabled = account.charges_enabled ?? false;
      if (chargesEnabled !== salon.charges_enabled) {
        await supabaseAdmin()
          .from("salons")
          .update({ charges_enabled: chargesEnabled })
          .eq("id", salon.id);
      }
    } catch {
      // Stripe caído no debe tumbar la página: se muestra el último estado conocido
    }
  }

  return (
    <main className="flex flex-col gap-6 max-w-2xl">
      <div>
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Cobros</h1>
          <Ayuda titulo="Cobros">
            <p>
              Con los cobros activados, tus clientes pueden pagar con tarjeta
              al reservar: una señal o la cita entera, tú eliges en cada
              servicio.
            </p>
            <p>
              <b>¿Para qué sirve?</b> Sobre todo contra los plantones: quien
              deja una señal, viene. Y si no viene, la señal es tuya.
            </p>
            <p>
              <b>Stripe</b> es la empresa que mueve el dinero (la usan miles
              de negocios). El alta es gratis: te pedirá tus datos y tu
              cuenta bancaria, directamente en su web — nosotros ni los vemos
              ni tocamos tu dinero. Lo cobrado te llega al banco cada pocos
              días.
            </p>
            <p>
              Una vez activado, ve a <b>Servicios</b> y elige en cada uno qué
              se cobra al reservar: nada, señal o importe completo.
            </p>
          </Ayuda>
        </span>
        <p className="text-muted mt-1">
          Cobra la cita o una señal al reservar. El dinero va directo a tu cuenta
          bancaria a través de Stripe — nosotros no lo tocamos.
        </p>
      </div>

      {chargesEnabled ? (
        <div className="panel p-6">
          <p className="font-semibold text-ok">✓ Cobros activados</p>
          <p className="text-muted mt-2 text-sm text-pretty">
            Ya puedes elegir qué se cobra en cada servicio desde{" "}
            <Link href="/admin/services" className="underline underline-offset-4">Servicios</Link>:
            nada, una señal o el importe completo. Los pagos llegan a tu banco
            según el calendario de Stripe (normalmente cada pocos días).
          </p>
          <form action={connectStripe} className="mt-4">
            <button className="btn-quiet text-sm">Actualizar datos bancarios</button>
          </form>
        </div>
      ) : (
        <div className="panel p-6">
          <p className="font-semibold">
            {salon.stripe_account_id ? "Alta sin terminar" : "Aún no cobras online"}
          </p>
          <p className="text-muted mt-2 text-sm text-pretty">
            {salon.stripe_account_id
              ? "Empezaste el alta en Stripe pero falta algún dato. Continúa donde lo dejaste."
              : "Conecta una cuenta de Stripe (gratis) para cobrar señales o citas al reservar. Te pedirá tus datos y tu cuenta bancaria — directamente en Stripe, nosotros no los vemos."}
          </p>
          <form action={connectStripe} className="mt-4">
            <button className="btn-primary">
              {salon.stripe_account_id ? "Continuar alta" : "Activar cobros"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

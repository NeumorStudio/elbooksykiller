import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { addService, deleteService, updateServicePayment } from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";
import Ayuda from "../ayuda";

const PAY_LABEL: Record<string, string> = {
  none: "Se paga en el local",
  deposit: "Señal al reservar",
  full: "Pago completo al reservar",
};

export default async function ServicesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, charges_enabled, services(*)")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const services = salon.services
    .filter((s) => s.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-8 max-w-2xl mx-auto">
      <div>
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Servicios</h1>
          <Ayuda titulo="Servicios">
            <p>
              Un servicio es cada cosa que se puede reservar en tu web: «Corte
              caballero», «Tinte», «Corte y barba»… Sin servicios, nadie puede
              reservar.
            </p>
            <p>
              <b>Para añadir uno</b>, rellena nombre, precio y minutos abajo.
              Los minutos importan: son lo que ocupa en la agenda y de ahí
              salen los huecos que se ofrecen a tus clientes. Si un corte te
              lleva media hora, pon 30.
            </p>
            <p>
              <b>«Quitar»</b> lo esconde de la web para nuevas reservas; las
              citas ya hechas no se tocan.
            </p>
            <p>
              Si tienes los cobros activados, en cada servicio puedes elegir
              si se paga al reservar: nada, una señal o el importe completo.
              La señal reduce mucho los plantones.
            </p>
          </Ayuda>
        </span>
        <p className="text-muted mt-1">Lo que tus clientes pueden reservar, con precio y duración.</p>
      </div>

      {services.length > 0 ? (
        <ul className="panel divide-y divide-line">
          {services.map((s) => (
            <li key={s.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.name}</p>
                  <p className="text-sm text-muted">
                    {s.duration_min} min · {PAY_LABEL[s.payment_type ?? "none"]}
                    {s.payment_type === "deposit" && s.deposit_cents
                      ? ` (${(s.deposit_cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })})`
                      : ""}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">
                  {(s.price_cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                </span>
                <form action={deleteService}>
                  <input type="hidden" name="id" value={s.id} />
                  <ConfirmSubmit message={`¿Quitar «${s.name}»? Dejará de poder reservarse.`}>
                    Quitar
                  </ConfirmSubmit>
                </form>
              </div>
              {salon.charges_enabled && (
                <ActionForm action={updateServicePayment} className="flex flex-wrap items-end gap-2 text-sm">
                  <input type="hidden" name="id" value={s.id} />
                  <div>
                    <label htmlFor={`pt-${s.id}`} className="label">Cobro al reservar</label>
                    <select
                      id={`pt-${s.id}`}
                      name="payment_type"
                      defaultValue={s.payment_type ?? "none"}
                      className="field w-52"
                    >
                      <option value="none">Nada (se paga en el local)</option>
                      <option value="deposit">Señal</option>
                      <option value="full">Importe completo</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`dp-${s.id}`} className="label">Señal (€)</label>
                    <input
                      id={`dp-${s.id}`}
                      name="deposit"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={s.deposit_cents ? s.deposit_cents / 100 : ""}
                      className="field w-24"
                    />
                  </div>
                  <SubmitButton className="btn-quiet">Guardar</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel p-8 text-center text-muted">
          <p className="font-medium text-ink">Aún no hay servicios</p>
          <p className="mt-1 text-pretty">
            Añade el primero abajo — por ejemplo “Corte caballero, 15 €, 30 min”.
          </p>
        </div>
      )}

      <ActionForm action={addService} className="panel p-5">
        <h2 className="font-semibold mb-4">Añadir servicio</h2>
        <input type="hidden" name="salon_id" value={salon.id} />
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_7rem_auto] gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="sv-name" className="label">Nombre</label>
            <input id="sv-name" name="name" required placeholder="Corte caballero" className="field" />
          </div>
          <div>
            <label htmlFor="sv-price" className="label">Precio (€)</label>
            <input id="sv-price" name="price" required type="number" step="0.01" min="0" placeholder="15" className="field" />
          </div>
          <div>
            <label htmlFor="sv-duration" className="label">Minutos</label>
            <input id="sv-duration" name="duration" required type="number" min="5" max="480" step="5" defaultValue={30} className="field" />
          </div>
          <SubmitButton className="btn-primary col-span-2 sm:col-span-1" pendingText="Añadiendo…">Añadir</SubmitButton>
        </div>
      </ActionForm>

      {!salon.charges_enabled && (
        <p className="text-sm text-muted">
          Para cobrar señales o citas al reservar,{" "}
          <Link href="/admin/payments" className="underline underline-offset-4">
            activa los cobros
          </Link>
          .
        </p>
      )}
    </main>
  );
}

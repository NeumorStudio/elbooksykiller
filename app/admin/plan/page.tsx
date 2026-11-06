import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { ESTADOS, PLANES, estaViva, euros, planPorId } from "@/lib/planes";
import SubmitButton from "../submit-button";
import { contratarPlan, gestionarPlan } from "./actions";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; error?: string }>;
}) {
  const { hecho, error } = await searchParams;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  if (!(await features()).suscripciones) {
    return <p className="text-muted">Esta sección todavía no está disponible.</p>;
  }

  const { data: suscripcion } = await supabase
    .from("suscripciones")
    .select("plan, estado, periodo_fin, cancela_al_final")
    .eq("salon_id", salon.id)
    .maybeSingle();

  const viva = suscripcion && estaViva(suscripcion.estado);
  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Tu plan</h1>
        <p className="text-muted mt-1">Sin permanencia: te das de baja cuando quieras, desde aquí.</p>
      </div>

      {hecho && !viva && (
        <p className="panel p-4 text-sm" role="status">
          Estamos confirmando tu pago. Si no aparece en un minuto, recarga la página.
        </p>
      )}
      {error === "config" && (
        <p className="panel p-4 text-sm text-danger" role="alert">
          No hemos podido abrir el pago. Escríbenos por WhatsApp y lo resolvemos.
        </p>
      )}

      {viva ? (
        <div className="panel p-6">
          <p className="font-semibold">{planPorId(suscripcion.plan)?.nombre ?? suscripcion.plan}</p>
          <p className="text-muted mt-2 text-sm text-pretty">
            {ESTADOS[suscripcion.estado] ?? suscripcion.estado}
            {suscripcion.periodo_fin &&
              (suscripcion.cancela_al_final
                ? `. Se da de baja el ${fecha(suscripcion.periodo_fin)}.`
                : `. Próximo cobro: ${fecha(suscripcion.periodo_fin)}.`)}
          </p>
          <form action={gestionarPlan} className="mt-4">
            <SubmitButton className="btn-quiet text-sm" pendingText="Abriendo…">
              Cambiar plan, tarjeta o darme de baja
            </SubmitButton>
          </form>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {PLANES.map((p) => (
              <form key={p.id} action={contratarPlan} className="panel p-5 flex flex-col gap-3">
                <input type="hidden" name="plan" value={p.id} />
                <h2 className="font-semibold">{p.nombre}</h2>
                <p>
                  <span className="font-display text-2xl font-semibold">{euros(p.cuotaCent)}</span>
                  <span className="text-muted text-sm"> al mes</span>
                </p>
                <p className="text-muted text-sm">Alta: {euros(p.altaCent)}, una sola vez</p>
                <ul className="text-sm flex flex-col gap-1.5 flex-1">
                  {p.incluye.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                  {p.pronto.map((i) => (
                    <li key={i} className="text-muted">
                      {i} (próximamente)
                    </li>
                  ))}
                </ul>
                <SubmitButton pendingText="Abriendo…">Elegir {p.nombre}</SubmitButton>
              </form>
            ))}
          </div>
          <p className="text-muted text-sm">Precios sin IVA. El 21 % se añade al pagar.</p>
        </>
      )}
    </main>
  );
}

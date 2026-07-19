import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { estadosPorCliente, type Estado } from "../rachas";
import { guardarPrograma, canjearPremio } from "./actions";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import ConfirmSubmit from "../confirm-submit";
import { telHref } from "@/lib/tel";

/**
 * Los clientes del salón: quién viene, con qué ritmo, y su tarjeta.
 *
 * Tarea de escritorio, modo "8 horas" — el momento "3 segundos de pie" de
 * la fidelización vive en la agenda (distintivo en la fila), no aquí.
 */
export default async function ClientesPage() {
  const f = await features();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  if (!f.clientes) {
    return (
      <main className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Clientes</h1>
        <p className="panel mt-6 p-6 text-muted text-pretty">
          Pendiente de activar: falta aplicar las migraciones de base de
          datos. En cuanto estén, esta pantalla se enciende sola.
        </p>
      </main>
    );
  }

  const [{ data: clientesRaw }, { data: visitasRaw }, { data: programa }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name, phone, email, marketing_opt_in")
        .eq("salon_id", salon.id),
      supabase
        .from("bookings")
        .select("customer_id, starts_at")
        .eq("salon_id", salon.id)
        .eq("status", "completed")
        .not("customer_id", "is", null),
      f.fidelizacion
        ? supabase
            .from("loyalty_programs")
            .select("active, required_visits, reward")
            .eq("salon_id", salon.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const clientes = clientesRaw ?? [];
  const estados = estadosPorCliente(
    (visitasRaw ?? []) as { customer_id: string; starts_at: string }[]
  );

  // Sellos disponibles por cliente, en una sola consulta.
  const sellos = new Map<string, number>();
  if (f.fidelizacion && programa?.active && clientes.length) {
    const { data: stamps } = await supabase
      .from("loyalty_stamps")
      .select("customer_id")
      .eq("salon_id", salon.id)
      .is("redemption_id", null);
    for (const s of stamps ?? []) {
      sellos.set(s.customer_id, (sellos.get(s.customer_id) ?? 0) + 1);
    }
  }

  const ETIQUETA: Record<Estado, { texto: string; clase: string }> = {
    racha: { texto: "En racha", clase: "text-ok" },
    nuevos: { texto: "Nuevo", clase: "text-muted" },
    enfriandose: { texto: "Enfriándose", clase: "text-brand" },
    perdido: { texto: "Perdido", clase: "text-danger" },
  };

  // Orden útil: primero los que hay que recuperar, luego los de premio.
  const orden: Estado[] = ["enfriandose", "racha", "nuevos", "perdido"];
  const listado = clientes
    .map((c) => ({
      ...c,
      ficha: estados.get(c.id) ?? null,
      sellosN: sellos.get(c.id) ?? 0,
    }))
    .sort((a, b) => {
      const ea = a.ficha ? orden.indexOf(a.ficha.estado) : 99;
      const eb = b.ficha ? orden.indexOf(b.ficha.estado) : 99;
      if (ea !== eb) return ea - eb;
      return (b.ficha?.visitas ?? 0) - (a.ficha?.visitas ?? 0);
    });

  const resumen = { racha: 0, nuevos: 0, enfriandose: 0, perdido: 0 };
  for (const c of listado) if (c.ficha) resumen[c.ficha.estado]++;

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Clientes</h1>
        <p className="text-muted mt-1">
          {clientes.length} en total · {resumen.racha} en racha ·{" "}
          <span className={resumen.enfriandose ? "text-brand font-medium" : ""}>
            {resumen.enfriandose} enfriándose
          </span>
        </p>
      </div>

      {/* ── Programa de sellos ─────────────────────────────────────── */}
      {f.fidelizacion && (
        <ActionForm action={guardarPrograma} className="panel p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Tarjeta de fidelidad</h2>
            <p className="text-sm text-muted mt-1 text-pretty">
              El sello se da solo cuando la cita se completa. Si subes las
              visitas necesarias, nadie pierde lo ya ganado.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="active"
              defaultChecked={programa?.active ?? false}
              className="h-5 w-5 accent-[var(--brand)]"
            />
            <span className="font-medium">Programa activo</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="lp-visitas" className="label">Visitas necesarias</label>
              <input
                id="lp-visitas"
                name="required_visits"
                type="number"
                min={2}
                max={50}
                defaultValue={programa?.required_visits ?? 6}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="lp-premio" className="label">Premio</label>
              <input
                id="lp-premio"
                name="reward"
                defaultValue={programa?.reward ?? "Corte gratis"}
                className="field"
              />
            </div>
          </div>
          <SubmitButton className="btn-primary self-start" pendingText="Guardando…">
            Guardar programa
          </SubmitButton>
        </ActionForm>
      )}

      {/* ── Listado ────────────────────────────────────────────────── */}
      {listado.length === 0 ? (
        <p className="panel p-6 text-muted text-pretty">
          Aún no hay clientes con teléfono válido. Se crean solos con cada
          reserva.
        </p>
      ) : (
        <ul className="tarjeta divide-y divide-line-subtle overflow-hidden">
          {listado.map((c) => {
            const et = c.ficha ? ETIQUETA[c.ficha.estado] : null;
            const req = programa?.required_visits ?? 0;
            const premiado =
              !!programa?.active && req > 0 && c.sellosN >= req;
            return (
              <li key={c.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {c.name}
                    {c.marketing_opt_in && (
                      <span
                        className="ml-2 text-xs text-muted"
                        title="Acepta recibir novedades"
                      >
                        ✉
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted truncate">
                    <a href={telHref(c.phone)} className="hover:underline">
                      {c.phone}
                    </a>
                    {c.ficha && (
                      <>
                        {" · "}
                        {c.ficha.visitas}{" "}
                        {c.ficha.visitas === 1 ? "visita" : "visitas"}
                        {c.ficha.cadenciaDias &&
                          ` · cada ~${c.ficha.cadenciaDias} días`}
                      </>
                    )}
                  </p>
                </div>
                {et && (
                  <span className={`shrink-0 text-sm font-medium ${et.clase}`}>
                    {et.texto}
                  </span>
                )}
                {programa?.active && (
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      premiado ? "font-semibold text-brand" : "text-muted"
                    }`}
                  >
                    {Math.min(c.sellosN, req)}/{req}
                  </span>
                )}
                {premiado && (
                  <ActionForm action={canjearPremio}>
                    <input type="hidden" name="customer_id" value={c.id} />
                    <ConfirmSubmit
                      className="btn-primary shrink-0 text-sm"
                      message={`¿Canjear "${programa!.reward}" de ${c.name}? Se consumen ${req} sellos.`}
                    >
                      Canjear
                    </ConfirmSubmit>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

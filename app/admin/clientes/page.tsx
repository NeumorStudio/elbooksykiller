import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { estadosPorCliente, type Estado } from "../rachas";
import { guardarPrograma, canjearPremio, guardarPenalizaciones, perdonarCliente } from "./actions";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import ConfirmSubmit from "../confirm-submit";
import { telHref } from "@/lib/tel";
import Ayuda from "../ayuda";
import ModuloApagado from "../modulo-apagado";
import { estadoSalon, moduloActivo } from "@/lib/modulos";

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
  if (!moduloActivo(await estadoSalon(salon.id), "clientes"))
    return <ModuloApagado titulo="Clientes" />;

  if (!f.clientes) {
    return (
      <main className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Clientes</h1>
        <p className="panel mt-6 p-6 text-muted text-pretty">
          Muy pronto. Aquí verás quién viene y con qué frecuencia, y podrás
          activar la tarjeta de fidelidad: un sello por visita y un premio al
          completarla. Estamos terminando de encenderla.
        </p>
      </main>
    );
  }

  const [{ data: clientesRaw }, { data: visitasRaw }, { data: programa }, { data: castigosRaw }] =
    await Promise.all([
      supabase
        .from("customers")
        // Las columnas de faltas solo existen tras la migración 0014.
        .select("id, name, phone, email, marketing_opt_in" +
          (f.penalizaciones ? ", no_show_strikes, blocked_until, banned" : ""))
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
      f.penalizaciones
        ? supabase
            .from("penalty_programs")
            .select("active, block_after, block_days, ban_after")
            .eq("salon_id", salon.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const castigos = castigosRaw as {
    active: boolean; block_after: number; block_days: number; ban_after: number;
  } | null;
  const clientes = (clientesRaw ?? []) as unknown as {
    id: string; name: string; phone: string; email: string | null; marketing_opt_in: boolean;
    no_show_strikes?: number; blocked_until?: string | null; banned?: boolean;
  }[];
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
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Clientes</h1>
          <Ayuda titulo="Clientes">
            <p>
              Tu lista de clientes se hace sola: cada persona que reserva se
              apunta aquí con su teléfono. No hay que dar de alta a nadie.
            </p>
            <p>Cada cliente lleva una etiqueta según su ritmo de visitas:</p>
            <ul className="flex flex-col gap-1.5 pl-1">
              <li><b className="text-ok">En racha</b> — viene con regularidad. Tu cliente fiel.</li>
              <li><b className="text-brand">Enfriándose</b> — venía a menudo y lleva más de la cuenta sin aparecer. Es a quien conviene escribir antes de perderlo.</li>
              <li><b>Nuevo</b> — una o dos visitas de momento.</li>
              <li><b className="text-danger">Perdido</b> — hace mucho que no viene.</li>
            </ul>
            <p>
              <b>La tarjeta de fidelidad</b> funciona como la de cartón de
              toda la vida, pero sin cartón: eliges cuántas visitas hacen
              falta y cuál es el premio. El sello se apunta solo cuando la
              cita se completa. Cuando alguien llega al premio, te sale el
              botón «Canjear» — púlsalo cuando se lo des.
            </p>
            <p>
              <b>Faltas y penalizaciones</b> protege tu agenda de quien
              reserva y no viene. Cuando marcas una cita como «no vino», ese
              cliente suma una falta: la primera le llega como aviso por
              email, a las que tú decidas se le bloquea la reserva online
              unos días, y si sigue faltando queda vetado. Se redime solo:
              cada cita a la que sí asiste borra una falta. Y si te cuenta un
              motivo de verdad, el botón «Perdonar» lo deja limpio al
              momento.
            </p>
            <p>
              El sobre ✉ junto a un nombre significa que aceptó recibir tus
              novedades por email (para la Newsletter).
            </p>
          </Ayuda>
        </span>
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

      {/* ── Penalizaciones por faltas ──────────────────────────────── */}
      {f.penalizaciones && (
        <ActionForm action={guardarPenalizaciones} className="panel p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Faltas y penalizaciones</h2>
            <p className="text-sm text-muted mt-1 text-pretty">
              Para quien reserva y no viene. La primera falta avisa por email;
              después se bloquea la reserva online. Cada cita a la que sí
              asiste limpia una falta, y tú puedes perdonar a quien tuvo un
              problema de verdad.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="active"
              defaultChecked={castigos?.active ?? false}
              className="h-5 w-5 accent-[var(--brand)]"
            />
            <span className="font-medium">Penalizaciones activas</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="pn-block" className="label">Bloquear a las… faltas</label>
              <input
                id="pn-block"
                name="block_after"
                type="number"
                min={1}
                max={10}
                defaultValue={castigos?.block_after ?? 2}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="pn-dias" className="label">Días de bloqueo</label>
              <input
                id="pn-dias"
                name="block_days"
                type="number"
                min={1}
                max={365}
                defaultValue={castigos?.block_days ?? 15}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="pn-ban" className="label">Veto a las… faltas</label>
              <input
                id="pn-ban"
                name="ban_after"
                type="number"
                min={2}
                max={20}
                defaultValue={castigos?.ban_after ?? 3}
                className="field"
              />
            </div>
          </div>
          <SubmitButton className="btn-primary self-start" pendingText="Guardando…">
            Guardar penalizaciones
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
            const faltas = c.no_show_strikes ?? 0;
            const bloqueadoHasta =
              c.blocked_until && new Date(c.blocked_until) > new Date()
                ? new Date(c.blocked_until).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
                : null;
            const sancion = c.banned
              ? "Vetado"
              : bloqueadoHasta
                ? `Bloqueado hasta ${bloqueadoHasta}`
                : faltas > 0
                  ? `${faltas} ${faltas === 1 ? "falta" : "faltas"}`
                  : null;
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
                {sancion && (
                  <span className="shrink-0 text-sm font-medium text-danger">
                    {sancion}
                  </span>
                )}
                {sancion && (
                  <ActionForm action={perdonarCliente}>
                    <input type="hidden" name="customer_id" value={c.id} />
                    <ConfirmSubmit
                      className="btn-quiet shrink-0 text-sm"
                      message={`¿Perdonar a ${c.name}? Sus faltas vuelven a cero y podrá reservar online de nuevo.`}
                    >
                      Perdonar
                    </ConfirmSubmit>
                  </ActionForm>
                )}
                {et && !sancion && (
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

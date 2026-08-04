import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { estadosPorCliente, type Estado } from "../rachas";
import {
  guardarPrograma,
  canjearPremio,
  guardarPenalizaciones,
  perdonarCliente,
  addPremio,
  deletePremio,
} from "./actions";
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
      <main className="max-w-2xl mx-auto">
        <h1 className="font-display text-3xl font-semibold">Clientes</h1>
        <p className="panel mt-6 p-6 text-muted text-pretty">
          Muy pronto. Aquí verás quién viene y con qué frecuencia, y podrás
          activar la tarjeta de fidelidad: un sello por visita y un premio al
          completarla. Estamos terminando de encenderla.
        </p>
      </main>
    );
  }

  const [
    { data: clientesRaw },
    { data: visitasRaw },
    { data: programa },
    { data: castigosRaw },
    { data: premiosRaw },
  ] = await Promise.all([
      supabase
        .from("customers")
        // Las columnas de faltas solo existen tras la migración 0014.
        .select("id, name, phone, email, marketing_opt_in" +
          (f.penalizaciones ? ", no_show_strikes, blocked_until, banned" : "") +
          // Solo tras la migración 0026.
          (f.cancelaciones ? ", late_cancellations" : ""))
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
      // El catálogo de premios (migración 0029).
      f.premios
        ? supabase
            .from("loyalty_rewards")
            .select("id, name, stamps")
            .eq("salon_id", salon.id)
            .eq("active", true)
            .order("stamps")
        : Promise.resolve({ data: [] }),
    ]);

  const castigos = castigosRaw as {
    active: boolean; block_after: number; block_days: number; ban_after: number;
  } | null;
  const listaPremios = (premiosRaw ?? []) as unknown as {
    id: string; name: string; stamps: number;
  }[];
  /** El escalón que viene después de las visitas que ya lleva. */
  const proximoEscalon = (visitas: number) =>
    listaPremios.find((p) => p.stamps > visitas)?.stamps ?? null;
  const clientes = (clientesRaw ?? []) as unknown as {
    id: string; name: string; phone: string; email: string | null; marketing_opt_in: boolean;
    no_show_strikes?: number; blocked_until?: string | null; banned?: boolean;
    late_cancellations?: number;
  }[];
  const estados = estadosPorCliente(
    (visitasRaw ?? []) as { customer_id: string; starts_at: string }[]
  );

  /**
   * Visitas por cliente y premios ya entregados.
   *
   * Con la escalera se cuentan las visitas de TODA la vida —sin filtrar por
   * `redemption_id`—, porque el contador no se reinicia al dar un premio: el
   * gel de la visita 15 es para quien siguió viniendo después del corte
   * gratis de la 9, no para quien empieza de cero otra vez.
   */
  const sellos = new Map<string, number>();
  const yaEntregados = new Map<string, Set<string>>();
  if (f.fidelizacion && programa?.active && clientes.length) {
    const consulta = supabase
      .from("loyalty_stamps")
      .select("customer_id")
      .eq("salon_id", salon.id);
    // Sin escalera (0031 sin aplicar) manda el modelo viejo: solo cuentan
    // los sellos que aún no se han gastado.
    const { data: stamps } = await (f.premios
      ? consulta
      : consulta.is("redemption_id", null));
    for (const s of stamps ?? []) {
      sellos.set(s.customer_id, (sellos.get(s.customer_id) ?? 0) + 1);
    }
    if (f.premios) {
      const { data: canjes } = await supabase
        .from("loyalty_redemptions")
        .select("customer_id, reward_id")
        .eq("salon_id", salon.id)
        .not("reward_id", "is", null);
      for (const c of (canjes ?? []) as unknown as { customer_id: string; reward_id: string }[]) {
        if (!yaEntregados.has(c.customer_id)) yaEntregados.set(c.customer_id, new Set());
        yaEntregados.get(c.customer_id)!.add(c.reward_id);
      }
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
    <main className="flex flex-col gap-8 max-w-2xl mx-auto">
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
            <p className="text-sm text-muted mt-2 text-pretty">
              Con el programa apagado tus clientes no ven la tarjeta por
              ningún sitio y no se apunta ningún sello. Puedes encenderlo
              cuando quieras: los sellos ya ganados siguen ahí.
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

      {/* ── Premios de la tarjeta ──────────────────────────────────────
          El catálogo: varios premios a la vez, cada uno con su precio en
          visitas. El cliente elige — con 5 se lleva el bote, con 9 el corte.
          Y quien ya gastó las 9 vuelve a acumular, así que el «segundo
          premio para los que ya tuvieron el corte» sale solo del contador,
          sin llevar escalones ni niveles. */}
      {f.premios && programa?.active && (
        <section className="panel p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Premios</h2>
            <p className="text-sm text-muted mt-1 text-pretty">
              Una escalera: cada premio se entrega al llegar a su visita, y el
              contador <b>no vuelve a empezar</b>. Así el segundo premio es
              para quien sigue viniendo después del primero — por ejemplo el
              décimo corte gratis <b>en la visita 9</b>, y un gel{" "}
              <b>en la 15</b>.
            </p>
          </div>

          {listaPremios.length > 0 && (
            <ul className="flex flex-col gap-2">
              {listaPremios.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg neu-in px-4 py-2.5"
                >
                  <span className="font-display text-xl tabular-nums text-brand w-10 shrink-0">
                    {p.stamps}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium block truncate">{p.name}</span>
                    <span className="text-sm text-muted">
                      al llegar a la visita {p.stamps}
                    </span>
                  </span>
                  <ActionForm action={deletePremio}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      className="btn-quiet border-0 text-sm text-muted hover:text-danger px-2"
                      message={`¿Quitar "${p.name}"? Los premios ya canjeados no se tocan.`}
                    >
                      Quitar
                    </ConfirmSubmit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}

          <ActionForm action={addPremio} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-40">
              <label htmlFor="pr-nombre" className="label">Premio</label>
              <input
                id="pr-nombre"
                name="name"
                required
                minLength={2}
                placeholder="Corte gratis, gomina…"
                className="field"
              />
            </div>
            <div>
              <label htmlFor="pr-sellos" className="label">En la visita</label>
              <input
                id="pr-sellos"
                name="stamps"
                type="number"
                min={1}
                max={100}
                defaultValue={9}
                required
                className="field w-24"
              />
            </div>
            <SubmitButton className="btn-quiet" pendingText="Añadiendo…">
              Añadir
            </SubmitButton>
          </ActionForm>
        </section>
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
            const tardias = c.late_cancellations ?? 0;
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
                    {/* Dato, no castigo: cancelar dentro de plazo es legítimo,
                        pero hacerlo siempre a última hora deja huecos que ya
                        no se llenan y hasta ahora no lo veía nadie. */}
                    {!!tardias && (
                      <span title="Canceló con menos de 2 horas de margen">
                        {" · "}
                        {tardias} {tardias === 1 ? "cancelación" : "cancelaciones"} a última hora
                      </span>
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
                    {/* Con escalera: las visitas que lleva y el escalón que
                        viene. Sin ella, los sellos sobre el premio único. */}
                    {listaPremios.length > 0
                      ? `${c.sellosN}${
                          proximoEscalon(c.sellosN) ? `/${proximoEscalon(c.sellosN)}` : ""
                        }`
                      : `${Math.min(c.sellosN, req)}/${req}`}
                  </span>
                )}
                {/* Con catálogo, un botón por premio que ya se pueda pagar:
                    el que tiene 12 sellos ve «Corte gratis» y «Gomina» y
                    elige. Sin catálogo, el botón único de siempre. */}
                {listaPremios.length > 0
                  ? listaPremios
                      // Escalones alcanzados y todavía sin entregar.
                      .filter(
                        (p) =>
                          c.sellosN >= p.stamps &&
                          !yaEntregados.get(c.id)?.has(p.id)
                      )
                      .map((p) => (
                        <ActionForm key={p.id} action={canjearPremio}>
                          <input type="hidden" name="customer_id" value={c.id} />
                          <input type="hidden" name="reward_id" value={p.id} />
                          <ConfirmSubmit
                            className="btn-primary shrink-0 text-sm"
                            message={`¿Darle "${p.name}" a ${c.name}? Le tocaba en la visita ${p.stamps} y va por la ${c.sellosN}.`}
                          >
                            {p.name}
                          </ConfirmSubmit>
                        </ActionForm>
                      ))
                  : premiado && (
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

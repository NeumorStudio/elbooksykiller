"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cancelBooking, setBookingStatus, addBooking, moverCita, type AltaOk } from "./actions";
import ConfirmSubmit from "./confirm-submit";
import ActionForm from "./action-form";
import SubmitButton from "./submit-button";
import { telHref } from "@/lib/tel";

export type Cita = {
  id: string;
  dia: string; // YYYY-MM-DD ya en la zona del salón
  iniMin: number; // minutos desde medianoche, zona del salón
  finMin: number;
  hora: string; // HH:MM
  pasada: boolean;
  employee_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  payment_status: string;
  servicio: string;
  profesional: string;
  precioCents: number;
  // Distintivo de fidelidad: el barbero ve que el siguiente va gratis
  // ANTES de cortar. null = sin programa o cliente sin sellos.
  sellos?: { tiene: number; requiere: number; premio: string } | null;
};

const fmtPrecio = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export type Profesional = {
  id: string;
  name: string;
  tramos: { weekday: number; start_min: number; end_min: number }[];
};

export type Servicio = { id: string; name: string; duration_min: number };

const CABECERA = ["L", "M", "X", "J", "V", "S", "D"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const clave = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fechaLarga = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  });
};

const PX_MIN = 1.5; // 90 px por hora: cabe un nombre sin apretar

export default function Agenda({
  citas,
  profesionales,
  servicios,
  hoy,
  ahoraMin,
}: {
  citas: Cita[];
  profesionales: Profesional[];
  servicios: Servicio[];
  hoy: string;
  ahoraMin: number; // minuto actual en la zona del salón
}) {
  const [sel, setSel] = useState(hoy);
  const [ancla, setAncla] = useState(() => {
    const [y, m] = hoy.split("-").map(Number);
    return { y, m: m - 1 };
  });
  // Hueco elegido al tocar el calendario: precarga el alta manual.
  const [hueco, setHueco] = useState<{ hora: string; empleado: string } | null>(null);
  // Última cita creada, para poder encadenar la siguiente a continuación.
  const [ultima, setUltima] = useState<AltaOk | null>(null);
  // Cita abierta en el panel de detalle (al tocar una cita del calendario).
  const [detalle, setDetalle] = useState<Cita | null>(null);

  // Cerrar el detalle en cuanto la cita deja de estar confirmada: al
  // cancelar/atender/marcar no-vino, la reserva sale de `citas` y el panel
  // se quedaría mostrando datos de algo que ya no existe.
  useEffect(() => {
    if (detalle && !citas.some((c) => c.id === detalle.id)) setDetalle(null);
  }, [citas, detalle]);
  // Cambiar de ronda remonta el formulario y lo deja limpio: después de
  // guardar, el nombre anterior en el campo invita a crear la misma cita dos
  // veces, que es justo el error que no se puede cometer con gente delante.
  const [ronda, setRonda] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Cita[]>();
    for (const c of citas) mapa.set(c.dia, [...(mapa.get(c.dia) ?? []), c]);
    return mapa;
  }, [citas]);

  const celdas = useMemo(() => {
    const primero = new Date(ancla.y, ancla.m, 1);
    const hueco = (primero.getDay() + 6) % 7; // lunes = 0
    const dias = new Date(ancla.y, ancla.m + 1, 0).getDate();
    const out: (string | null)[] = Array(hueco).fill(null);
    for (let d = 1; d <= dias; d++) out.push(clave(new Date(ancla.y, ancla.m, d)));
    return out;
  }, [ancla]);

  const delDia = porDia.get(sel) ?? [];
  const [sy, sm, sd] = sel.split("-").map(Number);
  const weekday = new Date(sy, sm - 1, sd).getDay();

  // Rango horario del día: la unión de los tramos del equipo.
  const rango = useMemo(() => {
    let ini = 24 * 60;
    let fin = 0;
    for (const p of profesionales) {
      for (const t of p.tramos) {
        if (t.weekday !== weekday) continue;
        ini = Math.min(ini, t.start_min);
        fin = Math.max(fin, t.end_min);
      }
    }
    if (ini >= fin) return null; // nadie trabaja este día
    // Redondear a horas en punto para que la regla de horas cuadre.
    return { ini: Math.floor(ini / 60) * 60, fin: Math.ceil(fin / 60) * 60 };
  }, [profesionales, weekday]);

  /** Huecos libres de un profesional: sus tramos menos lo que ya tiene. */
  const libresDe = (p: Profesional) => {
    const tramos = p.tramos
      .filter((t) => t.weekday === weekday)
      .sort((a, b) => a.start_min - b.start_min);
    const ocupado = delDia
      .filter((c) => c.employee_id === p.id)
      .sort((a, b) => a.iniMin - b.iniMin);
    const libres: { ini: number; fin: number }[] = [];
    for (const t of tramos) {
      let cursor = t.start_min;
      for (const c of ocupado) {
        if (c.finMin <= t.start_min || c.iniMin >= t.end_min) continue;
        if (c.iniMin > cursor) libres.push({ ini: cursor, fin: Math.min(c.iniMin, t.end_min) });
        cursor = Math.max(cursor, c.finMin);
      }
      if (cursor < t.end_min) libres.push({ ini: cursor, fin: t.end_min });
    }
    // Menos de 30 min no es un hueco reservable: la rejilla va de 30 en 30.
    return libres.filter((h) => h.fin - h.ini >= 30);
  };

  const irAlForm = () =>
    formRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });

  const elegirHueco = (hora: string, empleado: string) => {
    setHueco({ hora, empleado });
    requestAnimationFrame(irAlForm);
  };

  /**
   * Encadena la cita siguiente a la que se acaba de guardar: mismo día y
   * mismo profesional, a la hora en que queda libre.
   *
   * Deja el foco en el nombre porque es el único dato que falta — lo demás
   * ya viene puesto. `preventScroll` evita que el foco y el scroll suave se
   * peleen por llevar la vista a sitios distintos.
   */
  const encadenar = () => {
    if (!ultima?.fin) return;
    setSel(ultima.fecha);
    setHueco({ hora: ultima.fin, empleado: ultima.employee_id });
    setUltima(null);
    requestAnimationFrame(() => {
      document.getElementById("b-nombre")?.focus({ preventScroll: true });
      irAlForm();
    });
  };

  const mover = (delta: number) => {
    const d = new Date(ancla.y, ancla.m + delta, 1);
    setAncla({ y: d.getFullYear(), m: d.getMonth() });
  };

  const citasDeHoy = porDia.get(hoy) ?? [];
  const proxima = citasDeHoy.find((c) => !c.pasada);

  return (
    <section aria-label="Agenda" className="flex flex-col gap-6">
      {/* En tablet apaisada y escritorio, "hoy" y el mes caben uno al lado
          del otro: se ve quién viene ahora y dónde queda sitio sin hacer
          scroll. Por debajo de lg siguen apilados. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      {/* ── 1. Hoy, siempre lo primero ─────────────────────────────
          El barbero abre el panel 40 veces al día para una sola
          pregunta: quién viene ahora. */}
      <div>
        <h2 className="rotulo mb-3">Hoy · {fechaLarga(hoy)}</h2>
        {citasDeHoy.length === 0 ? (
          <p className="tarjeta p-5 text-center text-muted">
            Hoy no tienes ninguna cita.
          </p>
        ) : (
          <ul className="tarjeta divide-y divide-line-subtle overflow-hidden">
            {citasDeHoy.map((b) => (
              <FilaCita
                key={b.id}
                b={b}
                destacada={b.id === proxima?.id}
                onOpen={() => setDetalle(b)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── 2. El mes: para negociar fecha ─────────────────────────
          Aquí no se leen nombres, se ve dónde queda sitio. */}
      <div className="tarjeta p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => mover(-1)} className="btn-quiet h-10 w-10 px-0" aria-label="Mes anterior">‹</button>
          <p className="font-display text-lg first-letter:uppercase">{MESES[ancla.m]} {ancla.y}</p>
          <button onClick={() => mover(1)} className="btn-quiet h-10 w-10 px-0" aria-label="Mes siguiente">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-faint mb-1">
          {CABECERA.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celdas.map((k, i) => {
            if (!k) return <span key={`h${i}`} />;
            const n = (porDia.get(k) ?? []).length;
            const esHoy = k === hoy;
            const esSel = k === sel;
            return (
              <button
                key={k}
                onClick={() => { setSel(k); setHueco(null); }}
                aria-pressed={esSel}
                aria-label={`${Number(k.slice(8))}, ${n} ${n === 1 ? "cita" : "citas"}`}
                className={`flex h-12 flex-col items-center justify-center gap-1 rounded-xl text-sm transition-colors duration-150
                  ${esSel ? "bg-brand text-brand-ink font-semibold"
                    : esHoy ? "bg-brand-soft text-brand font-semibold"
                    : "text-ink hover:bg-surface-2"}`}
              >
                <span className="tabular-nums leading-none">{Number(k.slice(8))}</span>
                <span className="flex h-1 items-center gap-0.5" aria-hidden>
                  {n > 0 && (n > 3
                    ? <span className={`h-1 w-4 rounded-full ${esSel ? "bg-brand-ink/70" : "bg-brand"}`} />
                    : Array.from({ length: n }, (_, j) => (
                        <span key={j} className={`h-1 w-1 rounded-full ${esSel ? "bg-brand-ink/70" : "bg-brand"}`} />
                      )))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {/* ── 3. El día elegido, en rejilla horaria ──────────────────
          Ocupado en oro, libre pulsable. Tocar un hueco precarga el
          alta con día, hora y profesional: los tres campos más lentos
          resueltos de un toque. */}
      <div>
        <h2 className="rotulo mb-3">
          {sel === hoy ? "Hoy" : fechaLarga(sel)}
          <span className="font-normal normal-case tracking-normal text-faint">
            {delDia.length} {delDia.length === 1 ? "cita" : "citas"}
          </span>
        </h2>

        {!rango ? (
          <p className="tarjeta p-5 text-center text-muted">
            Nadie del equipo trabaja este día.{" "}
            <span className="block text-sm mt-1">
              Los horarios se configuran en Equipo.
            </span>
          </p>
        ) : (
          <div className="tarjeta overflow-x-auto">
            <div className="flex min-w-max w-full">
              {/* Regla de horas */}
              <div className="sticky left-0 z-10 w-12 shrink-0 bg-surface">
                <div className="h-9" />
                {Array.from({ length: (rango.fin - rango.ini) / 60 }, (_, i) => (
                  <div
                    key={i}
                    style={{ height: 60 * PX_MIN }}
                    className="relative text-right pr-2"
                  >
                    <span className="absolute -top-2 right-2 text-xs tabular-nums text-faint">
                      {hhmm(rango.ini + i * 60)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Una columna por profesional */}
              {profesionales.map((p) => {
                const suyas = delDia.filter((c) => c.employee_id === p.id);
                const libres = libresDe(p);
                return (
                  <div key={p.id} className="w-40 shrink-0 grow basis-40 border-l border-line-subtle">
                    <p className="h-9 flex items-center justify-center text-sm font-medium truncate px-2">
                      {p.name}
                    </p>
                    <div
                      className="relative"
                      style={{ height: (rango.fin - rango.ini) * PX_MIN }}
                    >
                      {/* Líneas de hora */}
                      {Array.from({ length: (rango.fin - rango.ini) / 60 }, (_, i) => (
                        <div
                          key={i}
                          className="absolute inset-x-0 border-t border-line-subtle"
                          style={{ top: i * 60 * PX_MIN }}
                        />
                      ))}

                      {/* Huecos libres: pulsables */}
                      {libres.map((h) => (
                        <button
                          key={`${p.id}-${h.ini}`}
                          onClick={() => elegirHueco(hhmm(h.ini), p.id)}
                          className="absolute inset-x-1 rounded-lg border border-dashed border-line
                            text-xs text-faint hover:border-brand hover:text-brand hover:bg-brand-soft
                            transition-colors duration-150 flex items-start justify-center pt-1"
                          style={{
                            top: (h.ini - rango.ini) * PX_MIN,
                            height: (h.fin - h.ini) * PX_MIN - 2,
                          }}
                          title={`Libre ${hhmm(h.ini)}–${hhmm(h.fin)} · añadir cita`}
                        >
                          {h.fin - h.ini >= 30 && `+ ${hhmm(h.ini)}`}
                        </button>
                      ))}

                      {/* Citas ocupadas: pulsables → detalle del cliente */}
                      {suyas.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setDetalle(c)}
                          className={`absolute inset-x-1 overflow-hidden rounded-lg bg-brand px-2 py-1 text-left
                            text-brand-ink transition-shadow hover:ring-2 hover:ring-brand-ink/30
                            ${c.pasada ? "opacity-50" : ""}`}
                          style={{
                            top: (c.iniMin - rango.ini) * PX_MIN,
                            height: (c.finMin - c.iniMin) * PX_MIN - 2,
                          }}
                          title={`${c.hora} · ${c.customer_name}`}
                        >
                          <p className="text-xs font-semibold tabular-nums leading-tight">{c.hora}</p>
                          <p className="text-xs font-medium truncate leading-tight">{c.customer_name}</p>
                          {c.finMin - c.iniMin >= 40 && (
                            <p className="text-[11px] truncate leading-tight opacity-80">{c.servicio}</p>
                          )}
                        </button>
                      ))}

                      {/* Línea de "ahora": la referencia temporal que más
                          se echa en falta cuando falta. */}
                      {sel === hoy && ahoraMin >= rango.ini && ahoraMin <= rango.fin && (
                        <div
                          aria-hidden
                          className="absolute inset-x-0 z-20 border-t-2 border-danger"
                          style={{ top: (ahoraMin - rango.ini) * PX_MIN }}
                        >
                          <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-danger" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-2 text-xs text-faint text-center">
          Toca una cita para ver los datos del cliente, o un hueco para añadir.
        </p>
      </div>

      {/* ── 4. Alta manual, precargada desde el hueco ─────────────── */}
      {servicios.length > 0 && profesionales.length > 0 && (
        <div ref={formRef}>
          <details className="tarjeta p-5" open={!!hueco || !!ultima}>
            <summary className="cursor-pointer select-none font-semibold marker:text-brand">
              Añadir cita a mano
              <span className="block text-sm font-normal text-muted mt-1">
                {hueco
                  ? `Hueco elegido: ${fechaLarga(sel)} a las ${hueco.hora}.`
                  : "Para quien llama por teléfono o entra sin reserva. También puedes tocar un hueco libre arriba."}
              </span>
            </summary>

            {/* Encadenar: quien viene acompañado se agenda seguido, sin
                volver a elegir día, hora ni profesional. */}
            {ultima && (
              <div role="status" className="mt-4 rounded-xl border border-brand bg-brand-soft p-3">
                <p className="text-sm">
                  Guardada la cita de <b>{ultima.nombre}</b> a las {ultima.hora}
                  {ultima.fin ? `, termina a las ${ultima.fin}` : ""}.
                </p>
                {ultima.fin && (
                  <button type="button" onClick={encadenar} className="btn-primary mt-3 w-full">
                    + Otra cita seguida, a las {ultima.fin}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setUltima(null)}
                  className="mt-1 min-h-11 w-full text-sm text-ink"
                >
                  Listo
                </button>
              </div>
            )}

            <ActionForm
              key={ronda}
              action={addBooking}
              onSuccess={(ok) => {
                setUltima(ok);
                setRonda((r) => r + 1);
              }}
              className="mt-4 flex flex-col gap-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="b-fecha" className="label">Día</label>
                  <input id="b-fecha" name="fecha" type="date" required
                    defaultValue={sel} key={`f-${sel}`} className="field" />
                </div>
                <div>
                  <label htmlFor="b-hora" className="label">Hora</label>
                  <input id="b-hora" name="hora" type="time" required step={300}
                    defaultValue={hueco?.hora} key={`h-${hueco?.hora ?? ""}`} className="field" />
                </div>
              </div>
              <div>
                <label htmlFor="b-serv" className="label">Servicio</label>
                <select id="b-serv" name="service_id" required className="field">
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {s.duration_min} min</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="b-prof" className="label">Profesional</label>
                <select id="b-prof" name="employee_id" required
                  defaultValue={hueco?.empleado} key={`p-${hueco?.empleado ?? ""}`} className="field">
                  {profesionales.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="b-nombre" className="label">Cliente</label>
                  <input id="b-nombre" name="customer_name" required minLength={2} className="field" />
                </div>
                <div>
                  <label htmlFor="b-tel" className="label">
                    Teléfono <span className="font-normal">(opcional)</span>
                  </label>
                  <input id="b-tel" name="customer_phone" type="tel" className="field" />
                </div>
              </div>
              {/* El teléfono no es burocracia: es lo que convierte la cita en
                  un cliente con ficha. Sin decirlo, se deja vacío por ir
                  rápido y ese cliente queda fuera de la tarjeta y de los
                  recordatorios para siempre. */}
              <p className="text-xs text-muted text-pretty -mt-1">
                Con el teléfono, esta persona entra en tus <b>Clientes</b>: suma
                tarjeta de fidelidad y puede recibir recordatorio de su cita. Sin
                él, la cita solo vive en tu agenda.
              </p>
              <SubmitButton className="btn-primary mt-1" pendingText="Guardando…">
                Añadir cita
              </SubmitButton>
            </ActionForm>
          </details>
        </div>
      )}

      {detalle && <DetalleCita c={detalle} onClose={() => setDetalle(null)} />}
    </section>
  );
}

/** Fila de cita clickable: un vistazo, y al tocar abre el detalle. */
function FilaCita({
  b,
  destacada = false,
  onOpen,
}: {
  b: Cita;
  destacada?: boolean;
  onOpen: () => void;
}) {
  return (
    <li className={b.pasada ? "opacity-60" : ""}>
      <button
        onClick={onOpen}
        className={`flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-surface-2
          ${destacada ? "bg-brand-soft" : ""}`}
      >
        <span className={`font-display tabular-nums text-xl w-14 shrink-0 ${destacada ? "text-brand" : ""}`}>
          {b.hora}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">
            {b.customer_name}
            {b.sellos && (
              <span
                className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs tabular-nums align-middle ${
                  b.sellos.tiene >= b.sellos.requiere
                    ? "bg-brand text-brand-ink font-semibold"
                    : "neu-in text-muted"
                }`}
              >
                {b.sellos.tiene >= b.sellos.requiere
                  ? `★ ${b.sellos.premio}`
                  : `${b.sellos.tiene}/${b.sellos.requiere}`}
              </span>
            )}
          </p>
          <p className="truncate">{b.servicio}</p>
          <p className="text-sm text-muted truncate">
            {b.customer_phone}
            {b.profesional && ` · con ${b.profesional}`}
          </p>
        </div>
        <span aria-hidden className="shrink-0 text-muted">›</span>
      </button>
    </li>
  );
}

/**
 * Panel de detalle de una cita: los datos del cliente y las acciones.
 *
 * Sustituye a los botones sueltos en cada fila — con gente delante, es más
 * claro abrir una ficha y actuar ahí que buscar el botón correcto en una
 * lista. Modal centrado, cerrable por fondo, Escape o la ✕.
 */
function DetalleCita({ c, onClose }: { c: Cita; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dato = (etiqueta: string, valor: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line-subtle last:border-0">
      <dt className="text-sm text-muted shrink-0">{etiqueta}</dt>
      <dd className="font-medium text-right min-w-0 break-words">{valor}</dd>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Cita de ${c.customer_name}`}
    >
      <div
        className="tarjeta w-full max-w-md max-h-[90vh] overflow-y-auto rounded-b-none sm:rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="rotulo after:hidden">
              {c.pasada ? "Cita pasada" : "Cita"}
            </p>
            <h2 className="font-display text-2xl truncate">{c.customer_name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="btn-quiet h-9 w-9 shrink-0 px-0 text-lg"
          >
            ✕
          </button>
        </div>

        {c.sellos && (
          <p
            className={`mt-3 inline-block rounded-full px-3 py-1 text-sm ${
              c.sellos.tiene >= c.sellos.requiere
                ? "bg-brand text-brand-ink font-semibold"
                : "neu-in text-muted"
            }`}
          >
            {c.sellos.tiene >= c.sellos.requiere
              ? `★ ${c.sellos.premio} conseguido`
              : `Tarjeta: ${c.sellos.tiene} de ${c.sellos.requiere}`}
          </p>
        )}

        <dl className="mt-4">
          {dato("Cuándo", `${c.hora} · ${c.servicio}`)}
          {dato("Con", c.profesional || "—")}
          {dato("Precio", fmtPrecio(c.precioCents))}
          {dato(
            "Teléfono",
            c.customer_phone && c.customer_phone !== "—" ? (
              <a href={telHref(c.customer_phone)} className="text-brand hover:underline">
                {c.customer_phone}
              </a>
            ) : (
              <span className="text-muted">Sin teléfono</span>
            )
          )}
          {dato(
            "Email",
            c.customer_email ? (
              <a href={`mailto:${c.customer_email}`} className="text-brand hover:underline break-all">
                {c.customer_email}
              </a>
            ) : (
              <span className="text-muted">Sin email</span>
            )
          )}
          {dato(
            "Pago",
            c.payment_status === "paid" ? (
              <span className="text-ok">Pagado online</span>
            ) : (
              <span className="text-muted">En el salón</span>
            )
          )}
        </dl>

        {/* Mover: solo mientras la cita esté por venir. Cambiar de hora una
            cita pasada no es mover nada, es reescribir el historial. */}
        {!c.pasada && (
          <ActionForm
            action={moverCita}
            className="mt-5 border-t border-line-subtle pt-4 flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={c.id} />
            <p className="label">Mover la cita</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-32">
                <label htmlFor={`mv-fecha-${c.id}`} className="sr-only">Nueva fecha</label>
                <input
                  id={`mv-fecha-${c.id}`}
                  name="fecha"
                  type="date"
                  defaultValue={c.dia}
                  className="field"
                />
              </div>
              <div className="w-28">
                <label htmlFor={`mv-hora-${c.id}`} className="sr-only">Nueva hora</label>
                <input
                  id={`mv-hora-${c.id}`}
                  name="hora"
                  type="time"
                  step={1800}
                  defaultValue={c.hora}
                  className="field"
                />
              </div>
              <SubmitButton className="btn-quiet" pendingText="Moviendo…">
                Mover
              </SubmitButton>
            </div>
            <p className="text-xs text-muted text-pretty">
              Se avisa al cliente del cambio y su enlace sigue valiendo.
            </p>
          </ActionForm>
        )}

        {/* Acciones: cerrar el ciclo solo cuando la hora ya pasó. */}
        <div className="mt-5 flex flex-col gap-2">
          {c.pasada && (
            <div className="flex gap-2">
              <form action={setBookingStatus} className="flex-1">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="status" value="completed" />
                <button className="btn-quiet w-full text-ok">✓ Atendida</button>
              </form>
              <form action={setBookingStatus} className="flex-1">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="status" value="no_show" />
                <ConfirmSubmit
                  className="btn-quiet w-full text-danger"
                  message={`¿${c.customer_name} no se presentó?`}
                >
                  ✕ No vino
                </ConfirmSubmit>
              </form>
            </div>
          )}
          <form action={cancelBooking}>
            <input type="hidden" name="id" value={c.id} />
            <ConfirmSubmit
              className="btn-quiet w-full text-danger hover:bg-danger/10"
              message={`¿Cancelar la cita de ${c.customer_name}? Si dejó su email, se le avisará automáticamente.${
                c.payment_status === "paid" ? " Se le devolverá el pago." : ""
              }`}
            >
              Cancelar cita
            </ConfirmSubmit>
          </form>
        </div>
      </div>
    </div>
  );
}

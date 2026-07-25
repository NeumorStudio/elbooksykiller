"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bookAppointment } from "./actions";
import { telHref } from "@/lib/tel";

type Service = {
  id: string;
  name: string;
  price_cents: number;
  duration_min: number;
  payment_type?: "none" | "deposit" | "full";
  deposit_cents?: number | null;
};

const amountDue = (s: Service) =>
  s.payment_type === "full" ? s.price_cents
  : s.payment_type === "deposit" ? (s.deposit_cents ?? 0)
  : 0;
type Employee = { id: string; name: string };
type Producto = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
};

const fmtPrice = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

function Step({
  n,
  title,
  id,
  onBack,
  children,
}: {
  n: number;
  title: string;
  id?: string;
  /** Vuelve al paso anterior deshaciendo esta elección. Los pasos no se
   *  colapsan —se puede subir y cambiar— pero el auto-scroll deja el
   *  anterior fuera de pantalla y parece que no hay marcha atrás. */
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4" aria-label={`Paso ${n}: ${title}`}>
      <h2 className="flex items-baseline gap-3 mb-4">
        <span className="font-display text-2xl text-brand tabular-nums" aria-hidden>
          {n}
        </span>
        <span className="text-lg font-semibold">{title}</span>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="ml-auto shrink-0 rounded-lg px-2 py-2 text-sm text-muted
              underline underline-offset-4 hover:text-brand
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ← Atrás
          </button>
        )}
      </h2>
      {children}
    </section>
  );
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

export default function BookingWidget({
  slug,
  timezone,
  salonName,
  salonPhone,
  services,
  employees,
  productos = [],
  conCuenta = false,
  cliente = null,
}: {
  slug: string;
  timezone: string;
  salonName: string;
  salonPhone: string | null;
  services: Service[];
  employees: Employee[];
  productos?: Producto[];
  conCuenta?: boolean;
  // Ficha de quien tiene sesión abierta: rellena el formulario para que
  // reserve con el mismo teléfono con el que ya está fichado.
  cliente?: { name: string; phone: string; email: string } | null;
}) {
  const [service, setService] = useState<Service | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState("");
  const [name, setName] = useState(cliente?.name ?? "");
  const [phone, setPhone] = useState(cliente?.phone ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // Productos apartados (id → true). Toggle simple: en un flujo de una mano
  // un stepper de cantidades es fricción; quien quiere dos botes lo dice en
  // el mostrador.
  const [cesta, setCesta] = useState<Record<string, boolean>>({});
  const [marketing, setMarketing] = useState(false); // sin premarcar (LSSI-CE)
  const [citaUrl, setCitaUrl] = useState<string | null>(null);
  const [omitidos, setOmitidos] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState<null | {
    serviceName: string; employeeName: string; slotIso: string; price: number;
  }>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`cita-${slug}`);
      if (raw) setRestored(JSON.parse(raw));
    } catch {}
  }, [slug]);

  // El error se renderiza al final del documento; si el paso 4 se acaba de
  // desmontar (hueco ocupado), en móvil quedaba fuera de la vista.
  useEffect(() => {
    if (!error) return;
    document.getElementById("bk-error")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  }, [error]);

  // Cada paso nuevo se monta bajo el fold: acercarlo a la vista
  // Salto instantáneo, no "smooth". La animación dura entre 300 y 600 ms y
  // durante ese tiempo la interfaz parece congelada: el botón ya respondió
  // —el estado cambia al momento— pero se percibe como lag. En un flujo de
  // cuatro pasos se acumula en cada toque.
  const scrollTo = (id: string) => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  };

  const days = useMemo(() => {
    const out: { iso: string; weekday: string; dayNum: string; month: string }[] = [];
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      out.push({
        iso: d.toLocaleDateString("sv-SE", { timeZone: timezone }),
        weekday: d.toLocaleDateString("es-ES", { weekday: "short", timeZone: timezone }),
        dayNum: d.toLocaleDateString("es-ES", { day: "numeric", timeZone: timezone }),
        month: d.toLocaleDateString("es-ES", { month: "short", timeZone: timezone }),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [timezone]);

  // Calendario mensual: solo los próximos 14 días admiten reserva, así que
  // la ventana abarca como mucho dos meses.
  const reservables = useMemo(() => new Set(days.map((d) => d.iso)), [days]);
  const meses = useMemo(
    () => [...new Set(days.map((d) => d.iso.slice(0, 7)))],
    [days]
  );
  const [mesVisto, setMesVisto] = useState(0);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });

  const hourOf = (iso: string) =>
    Number(
      new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: timezone })
    );

  useEffect(() => {
    if (!service || !employee || !day) return;
    setSlots(null);
    setSlot("");
    let stale = false;
    supabaseBrowser()
      .rpc("available_slots", { p_employee: employee.id, p_service: service.id, p_day: day })
      .then(({ data, error }) => {
        if (stale) return;
        if (error) setError("No se pudo cargar la disponibilidad. Inténtalo de nuevo.");
        else setSlots((data as string[]) ?? []);
      });
    return () => {
      stale = true;
    };
  }, [service, employee, day, refresh]);

  async function book() {
    setSaving(true);
    setError("");
    let result: Awaited<ReturnType<typeof bookAppointment>>;
    const enCesta = Object.keys(cesta).filter((id) => cesta[id]);
    try {
      result = await bookAppointment({
        employeeId: employee!.id,
        serviceId: service!.id,
        startIso: slot,
        name,
        phone,
        email: email.trim(),
        productos: enCesta.length ? enCesta.map((id) => ({ id, qty: 1 })) : undefined,
        marketing: marketing && !!email.trim(),
      });
    } catch {
      // Sin esto, un corte de red dejaba el botón en "Reservando…" para
      // siempre: la promesa rechazaba y setSaving(false) nunca corría.
      setError("No hay conexión. Comprueba tu red e inténtalo de nuevo.");
      setSaving(false);
      return;
    }
    setSaving(false);
    if ("error" in result) {
      if (result.error === "slot_unavailable") {
        setError("Ese hueco se acaba de ocupar. Elige otro.");
        setSlot("");
        setRefresh((r) => r + 1);
      } else if (result.error === "blocked") {
        // Penalización por faltas: el mensaje ya viene explicado del servidor.
        setError(result.message);
      } else {
        setError("No se pudo crear la reserva. Revisa tus datos.");
      }
    } else if ("checkoutUrl" in result) {
      window.location.href = result.checkoutUrl; // pago en Stripe
    } else {
      setCitaUrl(result.citaUrl ?? null);
      setOmitidos(result.omitidos ?? []);
      try {
        sessionStorage.setItem(
          `cita-${slug}`,
          JSON.stringify({
            serviceName: service!.name,
            employeeName: employee!.name,
            slotIso: slot,
            price: service!.price_cents,
          })
        );
      } catch {}
      setDone(true);
    }
  }

  const calLinks = (title: string, startIso: string, durationMin: number) => {
    const s = new Date(startIso);
    const e = new Date(s.getTime() + durationMin * 60000);
    const f = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      `DTSTART:${f(s)}`, `DTEND:${f(e)}`, `SUMMARY:${title}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    return {
      ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`,
      gcal: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(s)}/${f(e)}`,
    };
  };

  if (done) {
    const apartados = productos.filter((p) => cesta[p.id] && !omitidos.includes(p.id));
    const agotados = productos.filter((p) => omitidos.includes(p.id));
    return (
      <div className="panel p-8 text-center" role="status">
        <span className="font-display text-5xl text-ok block" aria-hidden>✓</span>
        <h2 className="mt-4 text-2xl font-semibold">Cita confirmada</h2>
        <dl className="mt-6 space-y-1 text-left mx-auto max-w-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Servicio</dt>
            <dd className="font-medium text-right">{service!.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Con</dt>
            <dd className="font-medium text-right">{employee!.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Cuándo</dt>
            <dd className="font-medium text-right">
              {new Date(slot).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: timezone,
              })}
              , {fmtTime(slot)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Precio</dt>
            <dd className="font-medium text-right">{fmtPrice(service!.price_cents)}</dd>
          </div>
          {apartados.map((p) => (
            <div key={p.id} className="flex justify-between gap-4">
              <dt className="text-muted">Apartado</dt>
              <dd className="font-medium text-right">
                {p.name} · {fmtPrice(p.price_cents)}
              </dd>
            </div>
          ))}
        </dl>
        {agotados.length > 0 && (
          <p className="mt-4 text-sm text-muted" role="alert">
            {agotados.map((p) => p.name).join(" y ")}{" "}
            {agotados.length > 1 ? "se han agotado" : "se ha agotado"} — el resto de tu
            reserva queda igual.
          </p>
        )}
        {citaUrl && (
          <a href={citaUrl} className="btn-primary mt-6 inline-flex">
            Ver o cancelar mi cita
          </a>
        )}
        {(() => {
          const links = calLinks(`${service!.name} en ${salonName}`, slot, service!.duration_min);
          return (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <a href={links.ics} download="cita.ics" className="btn-quiet text-sm">
                Añadir al calendario
              </a>
              <a href={links.gcal} target="_blank" rel="noopener" className="btn-quiet text-sm">
                Google Calendar
              </a>
            </div>
          );
        })()}
        <p className="mt-6 text-sm text-muted">
          Te esperamos en {salonName}.
          {salonPhone && (
            <>
              {" "}Si no puedes venir, avísanos al{" "}
              <a href={telHref(salonPhone)} className="underline underline-offset-4">
                {salonPhone}
              </a>
              .
            </>
          )}
        </p>
      </div>
    );
  }

  const reminder =
    restored && new Date(restored.slotIso) > new Date() ? (
      <div className="panel p-4 flex items-start gap-3 text-sm" role="status">
        <span className="text-ok text-lg" aria-hidden>✓</span>
        <p className="flex-1">
          Ya tienes una cita: <b>{restored.serviceName}</b> con {restored.employeeName},{" "}
          {new Date(restored.slotIso).toLocaleDateString("es-ES", {
            weekday: "long", day: "numeric", month: "long", timeZone: timezone,
          })}{" "}
          a las {fmtTime(restored.slotIso)}.
        </p>
        <button
          onClick={() => {
            try { sessionStorage.removeItem(`cita-${slug}`); } catch {}
            setRestored(null);
          }}
          aria-label="Ocultar recordatorio"
          className="text-muted hover:text-ink min-h-11 min-w-11 rounded-lg"
        >
          ×
        </button>
      </div>
    ) : null;

  const morning = (slots ?? []).filter((s) => hourOf(s) < 14);
  const afternoon = (slots ?? []).filter((s) => hourOf(s) >= 14);

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      {reminder}
      <Step n={1} id="paso-1" title="Elige servicio">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Servicio">
          {services.map((s) => {
            const on = service?.id === s.id;
            return (
              <button
                key={s.id}
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setService(s);
                  scrollTo("paso-2");
                }}
                className={`servicio-fila group flex items-baseline gap-4 rounded-xl border p-4 text-left
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
                  ${on ? "border-brand bg-brand/10" : "border-line bg-surface"}`}
              >
                {/* Carta de restaurante, no lista de botones: el nombre en
                    display, el precio alineado a la derecha con la línea de
                    puntos uniéndolos, y la duración en tercer nivel. */}
                <span className="min-w-0">
                  <span
                    className={`block font-display text-lg leading-tight ${on ? "text-brand" : ""}`}
                  >
                    {s.name}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {s.duration_min} min
                    {s.payment_type === "deposit" && amountDue(s) > 0 &&
                      ` · señal de ${fmtPrice(amountDue(s))}`}
                    {s.payment_type === "full" && ` · se paga al reservar`}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="h-px flex-1 self-center border-b border-dotted border-line"
                />
                <span
                  className={`shrink-0 font-display text-lg tabular-nums ${on ? "text-brand" : ""}`}
                >
                  {fmtPrice(s.price_cents)}
                </span>
              </button>
            );
          })}
        </div>
      </Step>

      {service && (
        <Step
          n={2}
          id="paso-2"
          title="¿Con quién?"
          onBack={() => {
            // Cambiar de servicio invalida hora y disponibilidad: se limpia
            // todo lo de abajo para no reservar con datos de otro servicio.
            setService(null);
            setEmployee(null);
            setDay("");
            setSlots(null);
            setSlot("");
            scrollTo("paso-1");
          }}
        >
          {/* En una barbería el profesional ES el producto: el cliente
              vuelve a por una persona. Renderizarlo como un chip igual que
              un día o una hora es lo que aplana el flujo. */}
          <div
            className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            role="radiogroup"
            aria-label="Profesional"
          >
            {employees.map((e) => {
              const on = employee?.id === e.id;
              return (
                <button
                  key={e.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setEmployee(e);
                    scrollTo("paso-3");
                  }}
                  className={`tarjeta tarjeta-int flex flex-col items-center gap-2 p-4
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
                    ${on ? "border-brand bg-brand/10" : ""}`}
                  style={{ touchAction: "manipulation" }}
                >
                  <span
                    aria-hidden
                    className={`flex h-12 w-12 items-center justify-center rounded-full font-display text-xl
                      ${on ? "bg-brand text-brand-ink" : "bg-surface-2 text-brand"}`}
                  >
                    {e.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className={`text-sm font-medium ${on ? "text-brand" : ""}`}>
                    {e.name}
                  </span>
                </button>
              );
            })}
          </div>
        </Step>
      )}

      {service && employee && (
        <Step
          n={3}
          id="paso-3"
          title="Día y hora"
          onBack={() => {
            setEmployee(null);
            setDay("");
            setSlots(null);
            setSlot("");
            setMesVisto(0);
            scrollTo("paso-2");
          }}
        >
          {(() => {
            const [y, m] = meses[mesVisto].split("-").map(Number);
            const primero = new Date(y, m - 1, 1);
            const hueco = (primero.getDay() + 6) % 7; // la semana empieza en lunes
            const nDias = new Date(y, m, 0).getDate();
            const hoy = days[0].iso;
            const flecha = `chip h-11 w-11 px-0 text-base disabled:opacity-35
              disabled:pointer-events-none`;
            return (
              <div className="max-w-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-display text-lg first-letter:uppercase">
                    {primero.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                  </p>
                  {meses.length > 1 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        aria-label="Mes anterior"
                        disabled={mesVisto === 0}
                        onClick={() => setMesVisto((v) => v - 1)}
                        className={flecha}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="Mes siguiente"
                        disabled={mesVisto === meses.length - 1}
                        onClick={() => setMesVisto((v) => v + 1)}
                        className={flecha}
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center" role="radiogroup" aria-label="Día">
                  {["L", "M", "X", "J", "V", "S", "D"].map((l, i) => (
                    <span key={i} className="text-xs text-faint pb-1" aria-hidden>
                      {l}
                    </span>
                  ))}
                  {Array.from({ length: hueco }, (_, i) => (
                    <span key={`h${i}`} aria-hidden />
                  ))}
                  {Array.from({ length: nDias }, (_, i) => {
                    const iso = `${meses[mesVisto]}-${String(i + 1).padStart(2, "0")}`;
                    const libre = reservables.has(iso);
                    const on = day === iso;
                    return (
                      <button
                        key={iso}
                        role="radio"
                        aria-checked={on}
                        disabled={!libre}
                        onClick={() => setDay(iso)}
                        className={`h-11 rounded-lg tabular-nums font-display text-base
                          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
                          ${
                            on
                              ? "bg-brand text-brand-ink font-semibold"
                              : !libre
                                ? "text-faint/50"
                                : iso === hoy
                                  ? "text-brand font-semibold cursor-pointer hover:bg-surface-2"
                                  : "text-ink cursor-pointer hover:bg-surface-2"
                          }`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* El skeleton tiene la geometría EXACTA del contenido real: si
              el layout salta al resolverse, has empeorado la percepción. */}
          {day && slots === null && !error && (
            <div className="mt-5 flex flex-col gap-4" aria-hidden>
              <span className="block h-4 w-20 rounded bg-surface-2 animate-pulse" />
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className="h-14 rounded-lg bg-surface-2 animate-pulse" />
                ))}
              </div>
            </div>
          )}

          {day && slots?.length === 0 && (
            <p className="mt-4 text-muted">
              No queda hueco este día. Prueba otro — los días con
              {" "}{employee.name} suelen llenarse rápido.
            </p>
          )}

          {slots && slots.length > 0 && (
            <div className="mt-5 flex flex-col gap-5">
              {[
                { label: "Mañana", list: morning },
                { label: "Tarde", list: afternoon },
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <p className="rotulo mb-3">
                      {g.label}
                      <span className="font-normal normal-case tracking-normal text-faint">
                        {g.list.length} {g.list.length === 1 ? "hueco" : "huecos"}
                      </span>
                    </p>
                    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={g.label}>
                      {g.list.map((s) => (
                        <button
                          key={s}
                          role="radio"
                          aria-checked={slot === s}
                          onClick={() => {
                            setSlot(s);
                            setError("");
                            scrollTo("paso-4");
                          }}
                          className={`chip h-14 tabular-nums text-base font-display
                            ${slot === s ? "chip-on" : ""}`}
                        >
                          {fmtTime(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Step>
      )}

      {slot && (
        <Step
          n={4}
          id="paso-4"
          title="Tus datos"
          onBack={() => {
            // Solo la hora: el día y la disponibilidad siguen valiendo.
            setSlot("");
            scrollTo("paso-3");
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              book();
            }}
          >
            <div>
              <label htmlFor="bk-name" className="label">Nombre</label>
              <input
                id="bk-name"
                required
                minLength={2}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="bk-phone" className="label">Teléfono</label>
              <input
                id="bk-phone"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={phone.length > 0 && digitsOf(phone).length < 9}
                className="field"
              />
              {phone.length > 0 && digitsOf(phone).length < 9 && (
                <p className="text-sm text-danger mt-1.5">
                  Pon un teléfono válido (al menos 9 dígitos) — lo usamos para avisarte de cualquier cambio.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="bk-email" className="label">
                Email <span className="font-normal">(opcional, para enviarte la confirmación)</span>
              </label>
              <input
                id="bk-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
              />
            </div>

            {/* La casilla solo aparece con email escrito: sin email no hay
                nada que consentir. Sin premarcar y con texto propio — es un
                consentimiento, no un peaje. */}
            {conCuenta && email.trim().length > 3 && (
              <label className="flex items-start gap-3 text-sm text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                />
                <span>
                  Quiero recibir por email las novedades y promociones de {salonName}.
                  Podrás darte de baja con un clic en cualquier momento.
                </span>
              </label>
            )}

            {/* Productos, DENTRO del último paso: cero pasos nuevos, cero
                pantallas extra. Sección invisible si el salón no vende nada.
                Nada aquí es obligatorio ni puede frenar la reserva. */}
            {productos.length > 0 && (
              <div className="mt-2">
                <p className="rotulo mb-3">
                  ¿Te llevas algo?
                  <span className="font-normal normal-case tracking-normal text-faint">
                    opcional — lo tendrás preparado
                  </span>
                </p>
                <div
                  className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 fade-x"
                  role="group"
                  aria-label="Productos para reservar"
                >
                  {productos.map((p) => {
                    const on = !!cesta[p.id];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCesta((c) => ({ ...c, [p.id]: !c[p.id] }))}
                        className={`chip shrink-0 flex-col items-start gap-1 px-4 py-3 h-auto min-w-[8.5rem] max-w-[11rem] text-left
                          ${on ? "chip-on" : ""}`}
                      >
                        <span className="text-sm font-medium leading-tight">
                          {on && <span aria-hidden>✓ </span>}
                          {p.name}
                        </span>
                        {p.description && (
                          <span className="text-xs opacity-70 leading-tight line-clamp-2">
                            {p.description}
                          </span>
                        )}
                        <span className="font-display tabular-nums">{fmtPrice(p.price_cents)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-faint mt-1">
                  Se paga en el local al recogerlo. Reservarlo no cuesta nada.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={saving || name.trim().length < 2 || digitsOf(phone).length < 9}
              className="btn-primary mt-2 text-base"
            >
              {(() => {
                const d = days.find((x) => x.iso === day);
                const when = d ? `${d.weekday} ${d.dayNum}, ${fmtTime(slot)}` : fmtTime(slot);
                const nSel = Object.values(cesta).filter(Boolean).length;
                return saving
                  ? "Reservando…"
                  : amountDue(service!) > 0
                    ? `Continuar al pago — ${fmtPrice(amountDue(service!))}`
                    : `Confirmar — ${when}${nSel > 0 ? ` · ${nSel} producto${nSel > 1 ? "s" : ""}` : ""}`;
              })()}
            </button>
          </form>
        </Step>
      )}

      {error && (
        <p id="bk-error" className="text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

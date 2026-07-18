"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bookAppointment } from "./actions";

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

const fmtPrice = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={`Paso ${n}: ${title}`}>
      <h2 className="flex items-baseline gap-3 mb-4">
        <span className="font-display text-2xl text-brand tabular-nums" aria-hidden>
          {n}
        </span>
        <span className="text-lg font-semibold">{title}</span>
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
}: {
  slug: string;
  timezone: string;
  salonName: string;
  salonPhone: string | null;
  services: Service[];
  employees: Employee[];
}) {
  const [service, setService] = useState<Service | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
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

  // Cada paso nuevo se monta bajo el fold: acercarlo a la vista
  const scrollTo = (id: string) => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
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
    const result = await bookAppointment({
      employeeId: employee!.id,
      serviceId: service!.id,
      startIso: slot,
      name,
      phone,
      email: email.trim(),
    });
    setSaving(false);
    if ("error" in result) {
      if (result.error === "slot_unavailable") {
        setError("Ese hueco se acaba de ocupar. Elige otro.");
        setSlot("");
        setRefresh((r) => r + 1);
      } else {
        setError("No se pudo crear la reserva. Revisa tus datos.");
      }
    } else if ("checkoutUrl" in result) {
      window.location.href = result.checkoutUrl; // pago en Stripe
    } else {
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

  if (done)
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
        </dl>
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
              <a href={`tel:${salonPhone}`} className="underline underline-offset-4">
                {salonPhone}
              </a>
              .
            </>
          )}
        </p>
      </div>
    );

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
    <div className="flex flex-col gap-10">
      {reminder}
      <Step n={1} title="Elige servicio">
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
                className={`flex items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors duration-150
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
                  ${on ? "border-brand bg-brand/10" : "border-line bg-surface hover:border-muted"}`}
              >
                <span>
                  <span className={`block font-medium ${on ? "text-brand" : ""}`}>{s.name}</span>
                  <span className="block text-sm text-muted">
                    {s.duration_min} min
                    {s.payment_type === "deposit" && amountDue(s) > 0 &&
                      ` · señal de ${fmtPrice(amountDue(s))} al reservar`}
                    {s.payment_type === "full" && ` · se paga al reservar`}
                  </span>
                </span>
                <span className={`font-semibold tabular-nums ${on ? "text-brand" : ""}`}>
                  {fmtPrice(s.price_cents)}
                </span>
              </button>
            );
          })}
        </div>
      </Step>

      {service && (
        <>
        <div id="paso-2" className="scroll-mt-4" />
        <Step n={2} title="¿Con quién?">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Profesional">
            {employees.map((e) => (
              <button
                key={e.id}
                role="radio"
                aria-checked={employee?.id === e.id}
                onClick={() => {
                  setEmployee(e);
                  scrollTo("paso-3");
                }}
                className={`chip px-5 ${employee?.id === e.id ? "chip-on" : ""}`}
              >
                {e.name}
              </button>
            ))}
          </div>
        </Step>
        </>
      )}

      {service && employee && (
        <>
        <div id="paso-3" className="scroll-mt-4" />
        <Step n={3} title="Día y hora">
          <div
            className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5"
            role="radiogroup"
            aria-label="Día"
          >
            {days.map((d) => {
              const on = day === d.iso;
              return (
                <button
                  key={d.iso}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDay(d.iso)}
                  className={`chip shrink-0 flex-col gap-0 px-4 py-2 h-auto min-w-16 ${on ? "chip-on" : ""}`}
                >
                  <span className="text-xs capitalize">{d.weekday}</span>
                  <span className="text-lg font-semibold leading-tight">{d.dayNum}</span>
                  <span className="text-xs capitalize">{d.month}</span>
                </button>
              );
            })}
          </div>

          {day && slots === null && !error && (
            <div className="mt-4 flex flex-wrap gap-2" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="h-11 w-16 rounded-lg bg-surface-2 animate-pulse" />
              ))}
            </div>
          )}

          {day && slots?.length === 0 && (
            <p className="mt-4 text-muted">
              No queda hueco este día. Prueba otro — los días con
              {" "}{employee.name} suelen llenarse rápido.
            </p>
          )}

          {slots && slots.length > 0 && (
            <div className="mt-4 flex flex-col gap-4">
              {[
                { label: "Mañana", list: morning },
                { label: "Tarde", list: afternoon },
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <p className="text-sm text-muted mb-2">{g.label}</p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={g.label}>
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
                          className={`chip tabular-nums min-w-16 ${slot === s ? "chip-on" : ""}`}
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
        </>
      )}

      {slot && (
        <>
        <div id="paso-4" className="scroll-mt-4" />
        <Step n={4} title="Tus datos">
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
            <button
              type="submit"
              disabled={saving || name.trim().length < 2 || digitsOf(phone).length < 9}
              className="btn-primary mt-2 text-base"
            >
              {(() => {
                const d = days.find((x) => x.iso === day);
                const when = d ? `${d.weekday} ${d.dayNum}, ${fmtTime(slot)}` : fmtTime(slot);
                return saving
                  ? "Reservando…"
                  : amountDue(service!) > 0
                    ? `Continuar al pago — ${fmtPrice(amountDue(service!))}`
                    : `Confirmar — ${when}`;
              })()}
            </button>
          </form>
        </Step>
        </>
      )}

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

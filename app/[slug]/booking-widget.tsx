"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bookAppointment } from "./actions";

type Service = { id: string; name: string; price_cents: number; duration_min: number };
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

export default function BookingWidget({
  timezone,
  salonName,
  salonPhone,
  services,
  employees,
}: {
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
    setError("");
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
    } else {
      setDone(true);
    }
  }

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

  const morning = (slots ?? []).filter((s) => hourOf(s) < 14);
  const afternoon = (slots ?? []).filter((s) => hourOf(s) >= 14);

  return (
    <div className="flex flex-col gap-10">
      <Step n={1} title="Elige servicio">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Servicio">
          {services.map((s) => {
            const on = service?.id === s.id;
            return (
              <button
                key={s.id}
                role="radio"
                aria-checked={on}
                onClick={() => setService(s)}
                className={`flex items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors duration-150
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
                  ${on ? "border-brand bg-brand/10" : "border-line bg-surface hover:border-muted"}`}
              >
                <span>
                  <span className={`block font-medium ${on ? "text-brand" : ""}`}>{s.name}</span>
                  <span className="block text-sm text-muted">{s.duration_min} min</span>
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
        <Step n={2} title="¿Con quién?">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Profesional">
            {employees.map((e) => (
              <button
                key={e.id}
                role="radio"
                aria-checked={employee?.id === e.id}
                onClick={() => setEmployee(e)}
                className={`chip px-5 ${employee?.id === e.id ? "chip-on" : ""}`}
              >
                {e.name}
              </button>
            ))}
          </div>
        </Step>
      )}

      {service && employee && (
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
                          onClick={() => setSlot(s)}
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
      )}

      {slot && (
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
                minLength={6}
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="field"
              />
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
              disabled={saving || name.trim().length < 2 || phone.trim().length < 6}
              className="btn-primary mt-2 text-base"
            >
              {saving
                ? "Reservando…"
                : `Confirmar — ${service!.name}, ${fmtTime(slot)}`}
            </button>
          </form>
        </Step>
      )}

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Service = { id: string; name: string; price_cents: number; duration_min: number };
type Employee = { id: string; name: string };

const fmtPrice = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export default function BookingWidget({
  timezone,
  services,
  employees,
}: {
  timezone: string;
  services: Service[];
  employees: Employee[];
}) {
  const [service, setService] = useState<Service | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });

  useEffect(() => {
    if (!service || !employee || !day) return;
    setSlots([]);
    setSlot("");
    setLoading(true);
    supabaseBrowser()
      .rpc("available_slots", {
        p_employee: employee.id,
        p_service: service.id,
        p_day: day,
      })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) setError("No se pudo cargar la disponibilidad.");
        else setSlots((data as string[]) ?? []);
      });
  }, [service, employee, day]);

  async function book() {
    setLoading(true);
    setError("");
    const { error } = await supabaseBrowser().rpc("create_booking", {
      p_employee: employee!.id,
      p_service: service!.id,
      p_start: slot,
      p_name: name,
      p_phone: phone,
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.includes("slot_unavailable")
          ? "Ese hueco se acaba de ocupar. Elige otro."
          : "No se pudo crear la reserva. Revisa tus datos."
      );
      if (error.message.includes("slot_unavailable")) setSlot("");
    } else {
      setDone(true);
    }
  }

  if (done)
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 dark:bg-green-950 p-6 text-center">
        <p className="text-xl font-semibold">✅ ¡Cita confirmada!</p>
        <p className="mt-2">
          {service!.name} con {employee!.name}
          <br />
          {new Date(slot).toLocaleDateString("es-ES", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: timezone,
          })}{" "}
          a las {fmtTime(slot)}
        </p>
      </div>
    );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-semibold mb-2">1. Servicio</h2>
        <div className="flex flex-col gap-2">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setService(s)}
              className={`rounded-lg border p-3 text-left flex justify-between ${
                service?.id === s.id ? "border-black dark:border-white bg-gray-100 dark:bg-gray-800" : "border-gray-300 dark:border-gray-700"
              }`}
            >
              <span>
                {s.name}
                <span className="text-gray-500 text-sm"> · {s.duration_min} min</span>
              </span>
              <span className="font-medium">{fmtPrice(s.price_cents)}</span>
            </button>
          ))}
        </div>
      </section>

      {service && (
        <section>
          <h2 className="font-semibold mb-2">2. Profesional</h2>
          <div className="flex flex-wrap gap-2">
            {employees.map((e) => (
              <button
                key={e.id}
                onClick={() => setEmployee(e)}
                className={`rounded-lg border px-4 py-2 ${
                  employee?.id === e.id ? "border-black dark:border-white bg-gray-100 dark:bg-gray-800" : "border-gray-300 dark:border-gray-700"
                }`}
              >
                {e.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {service && employee && (
        <section>
          <h2 className="font-semibold mb-2">3. Día y hora</h2>
          <input
            type="date"
            min={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2"
          />
          {loading && day && <p className="text-gray-500 mt-2">Buscando huecos…</p>}
          {!loading && day && slots.length === 0 && (
            <p className="text-gray-500 mt-2">No hay huecos ese día.</p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            {slots.map((s) => (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  slot === s ? "border-black dark:border-white bg-gray-100 dark:bg-gray-800" : "border-gray-300 dark:border-gray-700"
                }`}
              >
                {fmtTime(s)}
              </button>
            ))}
          </div>
        </section>
      )}

      {slot && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">4. Tus datos</h2>
          <input
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2"
          />
          <input
            placeholder="Teléfono"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2"
          />
          <button
            onClick={book}
            disabled={loading || name.trim().length < 2 || phone.trim().length < 6}
            className="rounded-lg bg-black text-white dark:bg-white dark:text-black p-3 font-medium disabled:opacity-40"
          >
            {loading ? "Reservando…" : `Confirmar cita · ${fmtTime(slot)}`}
          </button>
        </section>
      )}

      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

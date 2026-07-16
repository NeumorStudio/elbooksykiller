import { supabaseServer } from "@/lib/supabase/server";
import { createSalon, cancelBooking } from "./actions";

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!salon) {
    return (
      <main className="max-w-md mx-auto flex flex-col gap-4 pt-12">
        <h1 className="text-2xl font-bold">Crea tu peluquería</h1>
        <form action={createSalon} className="flex flex-col gap-3">
          <input name="name" required placeholder="Nombre (Barbería Paco)" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3" />
          <input name="slug" required minLength={3} placeholder="Dirección web (barberia-paco)" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3" />
          <input name="phone" placeholder="Teléfono (opcional)" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3" />
          <input name="address" placeholder="Dirección (opcional)" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3" />
          <button className="rounded-lg bg-black text-white dark:bg-white dark:text-black p-3 font-medium">
            Crear
          </button>
        </form>
      </main>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: upcoming }, { data: monthBookings }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, status, customer_name, customer_phone, services(name, price_cents), employees(name)")
      .eq("salon_id", salon.id)
      .gte("starts_at", now.toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(50),
    supabase
      .from("bookings")
      .select("services(price_cents)")
      .eq("salon_id", salon.id)
      .gte("starts_at", monthStart)
      .neq("status", "cancelled"),
  ]);

  const revenue = (monthBookings ?? []).reduce(
    (sum, b) => sum + ((b.services as unknown as { price_cents: number })?.price_cents ?? 0),
    0
  );

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: salon.timezone,
    });

  return (
    <main className="flex flex-col gap-6">
      <div className="flex gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex-1">
          <p className="text-sm text-gray-500">Citas este mes</p>
          <p className="text-2xl font-bold">{monthBookings?.length ?? 0}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex-1">
          <p className="text-sm text-gray-500">Facturación estimada</p>
          <p className="text-2xl font-bold">
            {(revenue / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
          </p>
        </div>
      </div>

      <h2 className="text-xl font-bold">Próximas citas</h2>
      {!upcoming?.length && <p className="text-gray-500">No hay citas pendientes.</p>}
      <ul className="flex flex-col gap-2">
        {upcoming?.map((b) => (
          <li
            key={b.id}
            className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between gap-3"
          >
            <div>
              <p className="font-medium">
                {fmt(b.starts_at)} — {(b.services as unknown as { name: string })?.name}
              </p>
              <p className="text-sm text-gray-500">
                {b.customer_name} · {b.customer_phone} · con{" "}
                {(b.employees as unknown as { name: string })?.name}
              </p>
            </div>
            <form action={cancelBooking}>
              <input type="hidden" name="id" value={b.id} />
              <button className="text-sm text-red-600">Cancelar</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}

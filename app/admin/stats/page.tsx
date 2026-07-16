import { supabaseServer } from "@/lib/supabase/server";

type Row = {
  starts_at: string;
  status: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
};

const eur = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export default async function StatsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, timezone")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const now = new Date();
  const since = new Date(now.getTime() - 91 * 86400000);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const { data } = await supabase
    .from("bookings")
    .select("starts_at, status, services(name, price_cents), employees(name)")
    .eq("salon_id", salon.id)
    .gte("starts_at", since.toISOString())
    .lt("starts_at", monthEnd.toISOString()) // incluye lo ya reservado del mes
    .neq("status", "pending_payment");
  const rows = (data ?? []) as unknown as Row[];

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = rows.filter((r) => new Date(r.starts_at) >= monthStart);
  const kept = (list: Row[]) => list.filter((r) => r.status !== "cancelled");
  const monthKept = kept(month);
  const revenue = monthKept.reduce((s, r) => s + (r.services?.price_cents ?? 0), 0);
  const noShows = month.filter((r) => r.status === "no_show").length;
  const cancelled = month.filter((r) => r.status === "cancelled").length;

  const tally = <K extends string>(list: Row[], key: (r: Row) => K) => {
    const m = new Map<K, { count: number; cents: number }>();
    for (const r of list) {
      const k = key(r);
      const cur = m.get(k) ?? { count: 0, cents: 0 };
      cur.count++;
      cur.cents += r.services?.price_cents ?? 0;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  };
  const byService = tally(monthKept, (r) => r.services?.name ?? "—");
  const byEmployee = tally(monthKept, (r) => r.employees?.name ?? "—");

  // Semanas (lunes a domingo) de las últimas 8
  const weekOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const weeks: { label: string; count: number; cents: number }[] = [];
  const thisWeek = weekOf(now);
  for (let i = 7; i >= 0; i--) {
    const start = new Date(thisWeek.getTime() - i * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    const inWeek = kept(rows).filter((r) => {
      const d = new Date(r.starts_at);
      return d >= start && d < end;
    });
    weeks.push({
      label: start.toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
      count: inWeek.length,
      cents: inWeek.reduce((s, r) => s + (r.services?.price_cents ?? 0), 0),
    });
  }
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));

  const monthName = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Estadísticas</h1>
        <p className="text-muted mt-1 first-letter:uppercase">{monthName}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Citas", String(monthKept.length)],
          ["Ingresos est.", eur(revenue)],
          ["Cancelaciones", String(cancelled)],
          ["No presentados", String(noShows)],
        ].map(([label, value]) => (
          <div key={label} className="panel p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="font-semibold mb-3">Últimas 8 semanas</h2>
        <ul className="panel divide-y divide-line">
          {weeks.map((w) => (
            <li key={w.label} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-20 text-muted">Sem. {w.label}</span>
              <span
                className="h-2.5 rounded-full bg-brand"
                style={{ width: `${(w.count / maxWeek) * 55}%`, minWidth: w.count ? "0.625rem" : "0" }}
                aria-hidden
              />
              <span className="tabular-nums font-medium ml-auto">{w.count} citas</span>
              <span className="tabular-nums text-muted w-20 text-right">{eur(w.cents)}</span>
            </li>
          ))}
        </ul>
      </section>

      {byService.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Por servicio (este mes)</h2>
          <ul className="panel divide-y divide-line">
            {byService.map(([name, v]) => (
              <li key={name} className="flex items-center px-4 py-2 text-sm">
                <span className="flex-1 truncate">{name}</span>
                <span className="tabular-nums font-medium w-16 text-right">{v.count}</span>
                <span className="tabular-nums text-muted w-24 text-right">{eur(v.cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byEmployee.length > 1 && (
        <section>
          <h2 className="font-semibold mb-3">Por profesional (este mes)</h2>
          <ul className="panel divide-y divide-line">
            {byEmployee.map(([name, v]) => (
              <li key={name} className="flex items-center px-4 py-2 text-sm">
                <span className="flex-1 truncate">{name}</span>
                <span className="tabular-nums font-medium w-16 text-right">{v.count}</span>
                <span className="tabular-nums text-muted w-24 text-right">{eur(v.cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 && (
        <p className="text-muted">
          Aún no hay datos: cuando lleguen reservas verás aquí la evolución del negocio.
        </p>
      )}
    </main>
  );
}

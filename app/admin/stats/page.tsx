import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import Ayuda from "../ayuda";
import ModuloApagado from "../modulo-apagado";
import { estadoSalon, moduloActivo } from "@/lib/modulos";

type Row = {
  starts_at: string;
  status: string;
  services: { name: string; price_cents: number } | null;
  employees: { name: string } | null;
};

const eur = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, timezone")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;
  if (!moduloActivo(await estadoSalon(salon.id), "estadisticas"))
    return <ModuloApagado titulo="Estadísticas" />;

  const now = new Date();
  // Mes seleccionado (?mes=YYYY-MM); por defecto, el actual
  const [y, m] = /^\d{4}-\d{2}$/.test(mes ?? "")
    ? mes!.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 1);
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const prevKey = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const nextKey = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  const since = new Date(Math.min(now.getTime() - 91 * 86400000, monthStart.getTime()));
  const until = new Date(Math.max(now.getTime() + 86400000, monthEnd.getTime()));
  const { data } = await supabase
    .from("bookings")
    .select("starts_at, status, services(name, price_cents), employees(name)")
    .eq("salon_id", salon.id)
    .gte("starts_at", since.toISOString())
    .lt("starts_at", until.toISOString())
    .neq("status", "pending_payment");
  const rows = (data ?? []) as unknown as Row[];

  const month = rows.filter((r) => {
    const d = new Date(r.starts_at);
    return d >= monthStart && d < monthEnd;
  });
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
  // Sin las semanas vacías del arranque: un salón nuevo veía siete filas
  // de ceros y una sola barra — mala primera impresión del propio negocio.
  const primeraConDatos = weeks.findIndex((w) => w.count > 0);
  const semanasVisibles = primeraConDatos === -1 ? [] : weeks.slice(primeraConDatos);

  const monthName = monthStart.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="flex items-center gap-2.5">
            <h1 className="font-display text-3xl font-semibold">Estadísticas</h1>
            <Ayuda titulo="Estadísticas">
              <p>
                Cómo va el negocio, mes a mes. Con las flechas ← → cambias de
                mes, o eliges uno concreto y pulsas «Ver».
              </p>
              <p>Los cuatro números de arriba, del mes que estás viendo:</p>
              <ul className="flex flex-col gap-1.5 pl-1">
                <li><b>Citas</b> — las que se hicieron (o están confirmadas si el mes no ha acabado).</li>
                <li><b>Ingresos est.</b> — la suma de los precios de esas citas. «Estimados» porque es lo que valen los servicios, no lo que pasó por caja.</li>
                <li><b>Cancelaciones</b> y <b>no presentados</b> — citas anuladas y gente que no vino. Si suben, las señales al reservar (en Cobros) ayudan.</li>
              </ul>
              <p>
                <b>Últimas 8 semanas</b> muestra la marcha reciente: cada
                barra es una semana. <b>Por servicio</b> y{" "}
                <b>por profesional</b> te dicen qué se pide más y quién
                factura más.
              </p>
            </Ayuda>
          </span>
          <p className="text-muted mt-1 first-letter:uppercase">{monthName}</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/admin/stats?mes=${prevKey}`}
            aria-label="Mes anterior"
            className="btn-quiet w-11 px-0"
          >
            ←
          </Link>
          <form className="flex items-center gap-1">
            <label htmlFor="mes" className="sr-only">Mes</label>
            <input
              id="mes"
              type="month"
              name="mes"
              defaultValue={monthKey}
              className="field w-40"
            />
            <button className="btn-quiet px-3">Ver</button>
          </form>
          <Link
            href={`/admin/stats?mes=${nextKey}`}
            aria-label="Mes siguiente"
            className="btn-quiet w-11 px-0"
          >
            →
          </Link>
        </div>
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
        {semanasVisibles.length > 0 ? (
          <ul className="panel divide-y divide-line">
            {semanasVisibles.map((w) => (
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
        ) : (
          <p className="panel p-4 text-sm text-muted">
            Aún sin actividad estas semanas — en cuanto entren reservas, aquí
            verás la evolución.
          </p>
        )}
      </section>

      {byService.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Por servicio</h2>
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
          <h2 className="font-semibold mb-3">Por profesional</h2>
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

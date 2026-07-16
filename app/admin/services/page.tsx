import { supabaseServer } from "@/lib/supabase/server";
import { addService, deleteService } from "../actions";

export default async function ServicesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, services(*)")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const services = salon.services
    .filter((s) => s.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Servicios</h1>
        <p className="text-muted mt-1">Lo que tus clientes pueden reservar, con precio y duración.</p>
      </div>

      {services.length > 0 ? (
        <ul className="panel divide-y divide-line">
          {services.map((s) => (
            <li key={s.id} className="flex items-center gap-4 p-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-sm text-muted">{s.duration_min} min</p>
              </div>
              <span className="font-semibold tabular-nums">
                {(s.price_cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
              </span>
              <form action={deleteService}>
                <input type="hidden" name="id" value={s.id} />
                <button className="btn-danger text-sm">Quitar</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel p-8 text-center text-muted">
          <p className="font-medium text-ink">Aún no hay servicios</p>
          <p className="mt-1 text-pretty">
            Añade el primero abajo — por ejemplo “Corte caballero, 15 €, 30 min”.
          </p>
        </div>
      )}

      <form action={addService} className="panel p-5">
        <h2 className="font-semibold mb-4">Añadir servicio</h2>
        <input type="hidden" name="salon_id" value={salon.id} />
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_7rem_auto] gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="sv-name" className="label">Nombre</label>
            <input id="sv-name" name="name" required placeholder="Corte caballero" className="field" />
          </div>
          <div>
            <label htmlFor="sv-price" className="label">Precio (€)</label>
            <input id="sv-price" name="price" required type="number" step="0.01" min="0" placeholder="15" className="field" />
          </div>
          <div>
            <label htmlFor="sv-duration" className="label">Minutos</label>
            <input id="sv-duration" name="duration" required type="number" min="5" max="480" step="5" defaultValue={30} className="field" />
          </div>
          <button className="btn-primary col-span-2 sm:col-span-1">Añadir</button>
        </div>
      </form>
    </main>
  );
}

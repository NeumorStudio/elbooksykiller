import { supabaseServer } from "@/lib/supabase/server";
import { addService, deleteService } from "../actions";

export default async function ServicesPage() {
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, services(*)")
    .limit(1)
    .maybeSingle();

  if (!salon) return <p>Primero crea tu peluquería en la Agenda.</p>;

  const services = salon.services
    .filter((s) => s.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Servicios</h1>

      <ul className="flex flex-col gap-2">
        {services.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between"
          >
            <span>
              {s.name}
              <span className="text-gray-500 text-sm">
                {" "}· {s.duration_min} min ·{" "}
                {(s.price_cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
              </span>
            </span>
            <form action={deleteService}>
              <input type="hidden" name="id" value={s.id} />
              <button className="text-sm text-red-600">Quitar</button>
            </form>
          </li>
        ))}
        {!services.length && <p className="text-gray-500">Aún no hay servicios.</p>}
      </ul>

      <form action={addService} className="flex flex-wrap gap-2 items-end">
        <input type="hidden" name="salon_id" value={salon.id} />
        <input name="name" required placeholder="Corte caballero" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2 flex-1 min-w-40" />
        <input name="price" required type="number" step="0.01" min="0" placeholder="€" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2 w-24" />
        <input name="duration" required type="number" min="5" max="480" step="5" defaultValue={30} title="Duración (min)" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2 w-24" />
        <button className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2">
          Añadir
        </button>
      </form>
      <p className="text-sm text-gray-500">Precio en euros y duración en minutos.</p>
    </main>
  );
}

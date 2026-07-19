import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { addProducto, updateProducto, deleteProducto } from "./actions";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import ConfirmSubmit from "../confirm-submit";

const eur = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/**
 * Productos del salón: lo que el cliente puede apartar junto a su cita.
 * El "borrado" es lógico (active=false): puede tener reservas históricas.
 */
export default async function ProductosPage() {
  const f = await features();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  if (!f.productos) {
    return (
      <main className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Productos</h1>
        <p className="panel mt-6 p-6 text-muted text-pretty">
          Pendiente de activar: falta aplicar las migraciones de base de
          datos. En cuanto estén, esta pantalla se enciende sola.
        </p>
      </main>
    );
  }

  const [{ data: productos }, { data: apartadosRaw }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, price_cents, stock")
      .eq("salon_id", salon.id)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    // Cuántos hay apartados en citas futuras: "3 reservados · quedan 5".
    supabase
      .from("booking_products")
      .select("product_id, quantity, bookings!inner(salon_id, status, starts_at)")
      .eq("bookings.salon_id", salon.id)
      .eq("bookings.status", "confirmed")
      .gte("bookings.starts_at", new Date().toISOString()),
  ]);

  const apartados = new Map<string, number>();
  for (const a of apartadosRaw ?? []) {
    const fila = a as unknown as { product_id: string; quantity: number };
    apartados.set(fila.product_id, (apartados.get(fila.product_id) ?? 0) + fila.quantity);
  }

  return (
    <main className="flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Productos</h1>
        <p className="text-muted mt-1 text-pretty">
          Aparecen en tu web al reservar: «¿Te llevas algo?». El cliente lo
          aparta y lo tiene preparado el día de su cita.
        </p>
      </div>

      {(productos?.length ?? 0) > 0 && (
        <ul className="flex flex-col gap-3">
          {productos!.map((p) => {
            const n = apartados.get(p.id) ?? 0;
            return (
              <li key={p.id} className="tarjeta p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    {p.description && (
                      <p className="text-sm text-muted text-pretty">{p.description}</p>
                    )}
                    <p className="text-sm text-muted mt-1">
                      {n > 0 && `${n} ${n === 1 ? "apartado" : "apartados"}`}
                      {n > 0 && p.stock != null && " · "}
                      {p.stock != null &&
                        `quedan ${Math.max(0, p.stock - n)} de ${p.stock}`}
                    </p>
                  </div>
                  <form action={deleteProducto}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      className="btn-quiet border-0 text-sm text-muted hover:text-danger px-2"
                      message={`¿Quitar "${p.name}" de la web? Las reservas ya hechas no se tocan.`}
                    >
                      Quitar
                    </ConfirmSubmit>
                  </form>
                </div>
                <ActionForm
                  action={updateProducto}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="id" value={p.id} />
                  <div>
                    <label htmlFor={`pr-${p.id}`} className="label">Precio (€)</label>
                    <input
                      id={`pr-${p.id}`}
                      name="price"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={(p.price_cents / 100).toFixed(2)}
                      className="field w-28"
                    />
                  </div>
                  <div>
                    <label htmlFor={`st-${p.id}`} className="label">
                      Stock <span className="font-normal">(vacío = sin control)</span>
                    </label>
                    <input
                      id={`st-${p.id}`}
                      name="stock"
                      type="number"
                      min="0"
                      defaultValue={p.stock ?? ""}
                      className="field w-28"
                    />
                  </div>
                  <SubmitButton className="btn-quiet text-sm" pendingText="Guardando…">
                    Guardar
                  </SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}

      <ActionForm action={addProducto} className="panel p-6 flex flex-col gap-4">
        <h2 className="font-semibold">Añadir producto</h2>
        <div>
          <label htmlFor="np-name" className="label">Nombre</label>
          <input
            id="np-name"
            name="name"
            required
            minLength={2}
            placeholder="Cera mate"
            className="field"
          />
        </div>
        <div>
          <label htmlFor="np-desc" className="label">
            Descripción <span className="font-normal">(opcional, una línea)</span>
          </label>
          <input
            id="np-desc"
            name="description"
            maxLength={120}
            placeholder="Fijación media, acabado natural"
            className="field"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="np-price" className="label">Precio (€)</label>
            <input
              id="np-price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              required
              className="field"
            />
          </div>
          <div>
            <label htmlFor="np-stock" className="label">
              Stock <span className="font-normal">(opcional)</span>
            </label>
            <input id="np-stock" name="stock" type="number" min="0" className="field" />
          </div>
        </div>
        <SubmitButton className="btn-primary self-start" pendingText="Añadiendo…">
          Añadir producto
        </SubmitButton>
      </ActionForm>
    </main>
  );
}

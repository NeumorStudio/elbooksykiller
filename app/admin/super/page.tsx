import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { esSuperadmin } from "@/lib/superadmin";
import { MODULOS, type Modulo } from "@/lib/modulos";
import { superBloquear, superGuardarModulos } from "./actions";
import ActionForm from "../action-form";
import SubmitButton from "../submit-button";
import ConfirmSubmit from "../confirm-submit";

type Fila = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  owner_id: string;
  blocked?: boolean;
  modules?: Partial<Record<Modulo, boolean>> | null;
};

export default async function SuperPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!esSuperadmin(user?.email)) redirect("/admin");

  const admin = supabaseAdmin();

  // Con la migración 0013 sin aplicar, blocked/modules no existen: se
  // listan los salones igual y se avisa de que los controles están apagados.
  let migracionPendiente = false;
  const conColumnas = await admin
    .from("salons")
    .select("id, name, slug, created_at, owner_id, blocked, modules")
    .order("created_at", { ascending: false });
  let filas = (conColumnas.data ?? []) as unknown as Fila[];
  if (conColumnas.error) {
    migracionPendiente = true;
    const sinColumnas = await admin
      .from("salons")
      .select("id, name, slug, created_at, owner_id")
      .order("created_at", { ascending: false });
    filas = (sinColumnas.data ?? []) as unknown as Fila[];
  }

  // Email de cada dueño. ponytail: una página de hasta 1000 usuarios;
  // paginar cuando la plataforma pase de ahí.
  const { data: usuarios } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailDe = new Map((usuarios?.users ?? []).map((u) => [u.id, u.email ?? "—"]));

  // Citas totales por salón. ponytail: una consulta por salón, agrupar en
  // una sola cuando haya cientos de salones.
  const citas = new Map(
    await Promise.all(
      filas.map(async (s) => {
        const { count } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("salon_id", s.id);
        return [s.id, count ?? 0] as const;
      })
    )
  );

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Superadmin</h1>
        <p className="text-muted mt-1">
          {filas.length} {filas.length === 1 ? "salón registrado" : "salones registrados"}.
          Bloquea cuentas y enciende o apaga módulos por salón.
        </p>
      </div>

      {migracionPendiente && (
        <p className="panel p-4 text-sm text-danger" role="alert">
          Falta aplicar la migración 0013 (<code>supabase db push</code>):
          los controles de bloqueo y módulos no funcionarán hasta entonces.
        </p>
      )}

      {filas.map((s) => {
        const bloqueado = !!s.blocked;
        return (
          <section
            key={s.id}
            className={`panel p-5 flex flex-col gap-4 ${bloqueado ? "opacity-70" : ""}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                  {s.name}
                  {bloqueado && (
                    <span className="text-xs font-medium text-danger border border-danger/40 rounded-full px-2 py-0.5">
                      Bloqueado
                    </span>
                  )}
                </h2>
                <p className="text-sm text-muted break-all">
                  <Link href={`/${s.slug}`} target="_blank" className="underline underline-offset-4">
                    /{s.slug} ↗
                  </Link>
                  {" · "}{emailDe.get(s.owner_id) ?? "—"}
                  {" · "}alta {fecha(s.created_at)}
                  {" · "}{citas.get(s.id)} {citas.get(s.id) === 1 ? "cita" : "citas"}
                </p>
              </div>

              <ActionForm action={superBloquear}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="blocked" value={bloqueado ? "0" : "1"} />
                {bloqueado ? (
                  <SubmitButton className="btn-quiet text-sm" pendingText="Desbloqueando…">
                    Desbloquear
                  </SubmitButton>
                ) : (
                  <ConfirmSubmit
                    message={`¿Bloquear «${s.name}»? Su web dejará de funcionar y su panel quedará en aviso.`}
                  >
                    Bloquear
                  </ConfirmSubmit>
                )}
              </ActionForm>
            </div>

            <ActionForm
              action={superGuardarModulos}
              className="flex flex-wrap items-center gap-2 border-t border-line pt-4"
            >
              <input type="hidden" name="id" value={s.id} />
              {(Object.keys(MODULOS) as Modulo[]).map((m) => (
                <label
                  key={m}
                  className="chip px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand
                    has-[:checked]:text-brand-ink has-[:checked]:font-semibold"
                >
                  <input
                    type="checkbox"
                    name={`mod-${m}`}
                    defaultChecked={s.modules?.[m] !== false}
                    className="sr-only"
                  />
                  {MODULOS[m].nombre}
                </label>
              ))}
              <SubmitButton className="btn-quiet text-sm ml-auto" pendingText="Guardando…">
                Guardar módulos
              </SubmitButton>
            </ActionForm>
          </section>
        );
      })}
    </main>
  );
}

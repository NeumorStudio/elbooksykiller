import type { Metadata } from "next";
import Link from "next/link";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import PerfilLogin from "./login";
import { vincularFichas, cerrarSesion } from "./actions";

/**
 * Área del cliente: su tarjeta de fidelidad de cada salón, entre
 * dispositivos. Es el plan B; la cita concreta vive en /cita/[token] sin
 * necesidad de esto. Por eso el login aquí es opcional — sirve para
 * conservar la tarjeta, no para verla.
 */
export const metadata: Metadata = {
  title: "Mi perfil",
  robots: { index: false, follow: false },
};

export default async function PerfilPage() {
  const { clientes, fidelizacion } = await features();

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const cabecera = (
    <header className="text-center">
      <h1 className="font-display text-3xl font-semibold text-brand">Mi perfil</h1>
    </header>
  );

  if (!clientes) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 flex-1 flex flex-col gap-6">
        {cabecera}
        <p className="panel p-6 text-center text-muted text-pretty">
          Pronto podrás guardar aquí tu tarjeta de fidelidad. De momento, tu
          cita vive en el enlace que te enviamos por email.
        </p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 flex-1 flex flex-col gap-6">
        {cabecera}
        <p className="text-center text-muted text-pretty">
          Entra con tu email para llevar tu tarjeta de fidelidad en cualquier
          móvil. No hace falta para ver una cita: esa está en el enlace de tu
          correo.
        </p>
        <PerfilLogin />
      </main>
    );
  }

  // Reclamar las fichas con este email que aún no tuvieran cuenta.
  if (user.email) await vincularFichas(user.id, user.email);

  const admin = supabaseAdmin();
  const { data: fichas } = await admin
    .from("customers")
    .select("id, name, salon_id, salons(name, slug)")
    .eq("auth_user_id", user.id);

  const tarjetas: {
    salon: string;
    slug: string;
    tiene: number;
    requiere: number;
    premio: string;
  }[] = [];

  if (fidelizacion) {
    for (const c of fichas ?? []) {
      const salon = (c as unknown as { salons: { name: string; slug: string } }).salons;
      const { data: prog } = await admin
        .from("loyalty_programs")
        .select("active, required_visits, reward")
        .eq("salon_id", (c as { salon_id: string }).salon_id)
        .maybeSingle();
      if (!prog?.active) continue;
      const { count } = await admin
        .from("loyalty_stamps")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", (c as { id: string }).id)
        .is("redemption_id", null);
      tarjetas.push({
        salon: salon.name,
        slug: salon.slug,
        tiene: count ?? 0,
        requiere: prog.required_visits,
        premio: prog.reward,
      });
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 py-14 flex-1 flex flex-col gap-6">
      {cabecera}
      <p className="text-center text-sm text-muted">{user.email}</p>

      {tarjetas.length === 0 ? (
        <p className="panel p-6 text-center text-muted text-pretty">
          Aún no tienes ninguna tarjeta de fidelidad activa. Cuando tu
          peluquería tenga una y vayas acumulando visitas, aparecerá aquí.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {tarjetas.map((t) => (
            <section key={t.slug} className="panel p-6" aria-label={`Tarjeta de ${t.salon}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl">{t.salon}</h2>
                <Link href={`/${t.slug}`} className="text-sm text-brand hover:underline">
                  Reservar
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap gap-2" aria-label={`${t.tiene} de ${t.requiere}`}>
                {Array.from({ length: t.requiere }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={`flex h-9 w-9 items-center justify-center rounded-full font-display text-sm
                      ${i < Math.min(t.tiene, t.requiere) ? "bg-brand text-brand-ink" : "neu-in text-faint"}`}
                  >
                    {i < Math.min(t.tiene, t.requiere) ? "✓" : i + 1}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm text-pretty">
                {t.tiene >= t.requiere ? (
                  <>
                    <span className="font-semibold text-brand">{t.premio}</span>{" "}
                    conseguido — díselo al equipo en tu próxima visita.
                  </>
                ) : (
                  <>
                    {t.tiene} de {t.requiere}. A {t.requiere - t.tiene} de:{" "}
                    <span className="font-semibold">{t.premio}</span>.
                  </>
                )}
              </p>
            </section>
          ))}
        </div>
      )}

      <form action={cerrarSesion} className="text-center mt-2">
        <button className="text-sm text-muted underline underline-offset-4 hover:text-ink">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}

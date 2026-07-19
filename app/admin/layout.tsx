import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { logout } from "./actions";
import Assistant from "./assistant";
import NavLinks from "./nav-links";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // /admin/login no lleva nav, pero sí el tema claro
  if (!user) return <div className="taller min-h-screen bg-bg text-ink flex flex-col">{children}</div>;

  const { data: salon } = await supabase
    .from("salons")
    .select("name, slug")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  return (
    <div className="taller min-h-screen bg-bg text-ink flex flex-col">
      <nav className="border-b border-line bg-bg sticky top-0 z-10 print:hidden">
        {/* Mismo degradado que la tira de días: en móvil la nav se desbordaba
            cortando "Estadísticas" sin señal de que se puede deslizar. */}
        <div className="mx-auto max-w-4xl px-5 h-14 flex items-center gap-1 overflow-x-auto whitespace-nowrap fade-x fade-x-solo-movil">
          <span className="font-display text-lg font-semibold text-brand mr-4 truncate hidden sm:block">
            {salon?.name ?? "Mi salón"}
          </span>
          <NavLinks />
          <div className="ml-auto flex items-center gap-1">
            <form action={logout}>
              <button className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface">
                Salir
              </button>
            </form>
          </div>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-4xl px-5 py-8 pb-28 flex-1">{children}</div>
      {salon && <Assistant />}
    </div>
  );
}

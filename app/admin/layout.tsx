import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { logout } from "./actions";
import Assistant from "./assistant";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // /admin/login no lleva nav, pero sí el tema claro
  if (!user) return <div className="day min-h-screen bg-bg text-ink flex flex-col">{children}</div>;

  const { data: salon } = await supabase
    .from("salons")
    .select("name, slug")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  return (
    <div className="day min-h-screen bg-bg text-ink flex flex-col">
      <nav className="border-b border-line bg-bg sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-5 h-14 flex items-center gap-1">
          <span className="font-display text-lg font-semibold text-brand mr-4 truncate hidden sm:block">
            {salon?.name ?? "Mi salón"}
          </span>
          <Link href="/admin" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface">
            Agenda
          </Link>
          <Link href="/admin/services" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface">
            Servicios
          </Link>
          <Link href="/admin/employees" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface">
            Equipo
          </Link>
          <Link href="/admin/payments" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface">
            Cobros
          </Link>
          <Link href="/admin/stats" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface">
            Estadísticas
          </Link>
          <div className="ml-auto flex items-center gap-1">
            {salon && (
              <Link
                href="/admin/website"
                className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface hidden sm:block"
              >
                Mi web
              </Link>
            )}
            <form action={logout}>
              <button className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface">
                Salir
              </button>
            </form>
          </div>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-4xl px-5 py-8 flex-1">{children}</div>
      {salon && <Assistant />}
    </div>
  );
}

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { logout } from "./actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // /admin/login no lleva nav
  if (!user) return <>{children}</>;

  const { data: salon } = await supabase
    .from("salons")
    .select("name, slug")
    .limit(1)
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-6 text-sm">
        <span className="font-bold">{salon?.name ?? "Mi salón"}</span>
        <Link href="/admin">Agenda</Link>
        <Link href="/admin/services">Servicios</Link>
        <Link href="/admin/employees">Equipo</Link>
        {salon && (
          <Link href={`/${salon.slug}`} className="text-gray-500" target="_blank">
            Ver mi web ↗
          </Link>
        )}
        <form action={logout} className="ml-auto">
          <button className="text-gray-500">Salir</button>
        </form>
      </nav>
      <div className="max-w-3xl mx-auto p-6">{children}</div>
    </div>
  );
}

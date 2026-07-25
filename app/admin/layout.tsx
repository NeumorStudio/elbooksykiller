import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { logout } from "./actions";
import Assistant from "./assistant";
import NavLinks from "./nav-links";
import { esSuperadmin } from "@/lib/superadmin";
import { estadoSalon, moduloActivo, MODULOS, type Modulo } from "@/lib/modulos";
import { AvisoInstalar } from "./instalar";

// El panel se instala como app aparte de la web de reservas: su scope es
// /admin, así que abre directo en la agenda y no en la página del salón.
export const metadata = {
  title: "Salonio — mi agenda",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Salonio", statusBarStyle: "black-translucent" as const },
  icons: { apple: "/admin/pwa-icon?size=180" },
};
export const viewport = { themeColor: "#222325" };

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
    .select("id, name, slug")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  const esSuper = esSuperadmin(user.email);
  const estado = salon ? await estadoSalon(salon.id) : null;

  // Salón bloqueado por el superadmin: panel entero en aviso. El superadmin
  // nunca se bloquea a sí mismo el acceso a /admin/super.
  if (estado?.blocked && !esSuper) {
    return (
      <div className="taller min-h-screen bg-bg text-ink flex items-center justify-center p-6">
        <div className="panel max-w-md p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">Cuenta bloqueada</h1>
          <p className="text-muted mt-3 text-pretty">
            Tu web y tu panel están desactivados temporalmente. Escríbenos y
            lo resolvemos.
          </p>
          <form action={logout} className="mt-6">
            <button className="btn-quiet">Salir</button>
          </form>
        </div>
      </div>
    );
  }

  // Módulos apagados: sus enlaces desaparecen del menú.
  const ocultos = estado
    ? (Object.keys(MODULOS) as Modulo[])
        .filter((m) => !moduloActivo(estado, m))
        .map((m) => MODULOS[m].href)
    : [];

  return (
    <div className="taller min-h-screen bg-bg text-ink flex flex-col">
      <nav className="border-b border-line bg-bg sticky top-0 z-10 print:hidden">
        {/* Sin scroll horizontal: con lo diario visible y el resto bajo
            «Más», la barra cabe entera hasta en 360px. */}
        <div className="mx-auto max-w-4xl px-4 sm:px-5 h-14 flex items-center gap-1 whitespace-nowrap">
          <span className="font-display text-lg font-semibold text-brand mr-4 truncate hidden sm:block">
            {esSuper ? "Superadmin" : (salon?.name ?? "Mi salón")}
          </span>
          {/* El superadmin no gestiona un salón: su menú es solo el panel. */}
          {esSuper ? (
            <Link
              href="/admin/super"
              className="px-3 min-h-11 inline-flex items-center rounded-lg text-sm font-medium text-brand hover:bg-surface"
            >
              Super
            </Link>
          ) : (
            <NavLinks ocultos={ocultos} />
          )}
          <div className="ml-auto flex items-center gap-1">
            <form action={logout}>
              <button className="px-2 sm:px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface">
                Salir
              </button>
            </form>
          </div>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-4xl px-5 py-8 pb-28 flex-1">{children}</div>
      {salon && !esSuper && <Assistant />}
      {salon && <AvisoInstalar />}
    </div>
  );
}

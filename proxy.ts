import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isPlatformHost(host: string) {
  const h = host.split(":")[0];
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".vercel.app") ||
    h.endsWith(".vercel.dev")
  );
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Dominio propio de un salón: la raíz sirve su página de reservas.
  // (Las rutas profundas tipo /mi-slug funcionan en cualquier host sin rewrite.)
  if (pathname === "/") {
    const host = request.headers.get("host") ?? "";
    if (host && !isPlatformHost(host)) {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/salons?custom_domain=eq.${encodeURIComponent(
          host.split(":")[0]
        )}&select=slug`,
        {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
          next: { revalidate: 60 },
        }
      );
      const rows = res.ok ? await res.json() : [];
      if (rows[0]?.slug) {
        return NextResponse.rewrite(new URL(`/${rows[0].slug}`, request.url));
      }
    }
    return NextResponse.next();
  }

  // Refresco de sesión para /admin y /perfil; guard solo para /admin.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() renueva el access token y reescribe las cookies vía setAll.
  // Los Server Components no pueden hacerlo (lib/supabase/server.ts:19-21),
  // así que sin pasar por aquí la sesión de /perfil caducaba sola.
  const { data: { user } } = await supabase.auth.getUser();

  // /perfil solo necesita ese refresco: tiene su propio login por magic link
  // y verla sin sesión es legítimo. El guard de abajo es solo para dueños.
  if (!pathname.startsWith("/admin")) return response;

  const isLogin = pathname === "/admin/login";
  // El navegador pide manifest e iconos SIN cookies: si el guard los
  // redirige al login, la instalación del panel como app no llega a
  // ofrecerse. No llevan ningún dato privado.
  const publicoPWA =
    pathname === "/admin/manifest.webmanifest" || pathname === "/admin/pwa-icon";

  if (!user && !isLogin && !publicoPWA) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (user && isLogin) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

// /:slug/perfil además de /perfil: la PWA de cada salón sirve «Mi cuenta»
// dentro de su scope, y esa ruta necesita el mismo refresco de sesión.
export const config = {
  matcher: ["/admin/:path*", "/perfil/:path*", "/:slug/perfil/:path*", "/"],
};

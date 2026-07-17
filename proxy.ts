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

  // Rutas /admin: refresco de sesión + guard en ambos sentidos
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

  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = pathname === "/admin/login";

  if (!user && !isLogin) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (user && isLogin) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = { matcher: ["/admin/:path*", "/"] };

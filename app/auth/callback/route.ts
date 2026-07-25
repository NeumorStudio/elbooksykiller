import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Retorno del magic link: cambia el código por una sesión y lleva al
 * cliente a su perfil. Es el plan B de identidad (persistencia entre
 * dispositivos); el plan A sigue siendo el token de /cita/[token], que
 * funciona sin esto — importante porque el magic link se rompe en el
 * navegador interno de Instagram.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Solo rutas internas: new URL("https://evil.tld", origin) devuelve el
  // dominio ajeno tal cual, así que sin este filtro el magic link servía de
  // trampolín de phishing desde nuestro propio dominio. `//host` también
  // es absoluta.
  const pedido = url.searchParams.get("next");
  const next =
    pedido?.startsWith("/") && !pedido.startsWith("//") ? pedido : "/perfil";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/perfil?error=1", url.origin));
}

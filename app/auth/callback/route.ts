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
  const next = url.searchParams.get("next") ?? "/perfil";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/perfil?error=1", url.origin));
}

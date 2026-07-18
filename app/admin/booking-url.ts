import "server-only";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { domainStatus } from "@/lib/vercel";

// URL pública de reservas del salón del dueño logueado:
// su dominio propio si ya está activo; si no, la de plataforma.
export async function ownerBookingUrl() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: salon } = await supabase
    .from("salons")
    .select("slug, name, custom_domain, logo_url")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return null;

  let url: string;
  if (salon.custom_domain && (await domainStatus(salon.custom_domain)).configured) {
    url = `https://${salon.custom_domain}`;
  } else {
    const h = await headers();
    url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/${salon.slug}`;
  }
  return { url, salon };
}

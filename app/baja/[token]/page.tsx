import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import BajaBoton from "./baja-boton";

/**
 * Baja de la newsletter: un clic, sin login (art. 21 LSSI-CE).
 *
 * La baja NO se ejecuta en el GET: los escáneres de correo corporativos
 * prefetchean los enlaces de cada email, y darían de baja a media lista sin
 * que nadie tocara nada. La página pide una confirmación explícita.
 */
export const metadata: Metadata = {
  title: "Baja de la newsletter",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BajaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { clientes } = await features();
  if (!clientes || !UUID_RE.test(token)) notFound();

  const { data } = await supabaseAdmin()
    .from("customers")
    .select("marketing_opt_in, salons(name)")
    .eq("baja_token", token)
    .maybeSingle();
  if (!data) notFound();

  const salonName =
    (data as unknown as { salons: { name: string } | null }).salons?.name ?? "el salón";

  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 flex-1 flex flex-col items-center gap-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-balance">
        Novedades de {salonName}
      </h1>
      {data.marketing_opt_in ? (
        <>
          <p className="text-muted text-pretty">
            Si te das de baja dejarás de recibir promociones y novedades.
            Los avisos de tus citas (confirmaciones y recordatorios) no se
            tocan: esos siguen llegando.
          </p>
          <BajaBoton token={token} />
        </>
      ) : (
        <p className="text-muted text-pretty" role="status">
          Ya estabas fuera de la lista. No recibirás más novedades de{" "}
          {salonName}.
        </p>
      )}
    </main>
  );
}

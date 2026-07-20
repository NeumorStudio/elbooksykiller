import type { Metadata } from "next";
import PerfilContenido from "@/app/perfil/contenido";
import BarraInferior from "../barra-inferior";

/**
 * Mi cuenta, dentro del scope de la PWA del salón.
 *
 * El manifest declara scope "/[slug]" (manifest.webmanifest/route.ts:29),
 * así que desde la app instalada un enlace a /perfil se sale del ámbito:
 * Android lo abre en una pestaña con barra de URL e iOS expulsa a Safari.
 * Esta ruta sirve el mismo contenido sin romper la app.
 *
 * El contenido es idéntico a propósito: la ficha del cliente es por salón,
 * pero su cuenta es de plataforma y ve las tarjetas de todos los salones
 * donde tenga ficha. Cambiarlo aquí lo haría inconsistente con /perfil.
 */
export const metadata: Metadata = {
  title: "Mi cuenta",
  robots: { index: false, follow: false },
};

export default async function PerfilDelSalon({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <>
      <PerfilContenido />
      {/* Para no perder la navegación al entrar aquí desde la barra. */}
      <BarraInferior slug={slug} />
    </>
  );
}

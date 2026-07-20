import type { Metadata } from "next";
import PerfilContenido from "./contenido";

/**
 * Área de cliente de plataforma. El contenido está en ./contenido porque
 * /[slug]/perfil renderiza exactamente lo mismo dentro del scope de la PWA
 * de cada salón.
 */
export const metadata: Metadata = {
  title: "Mi perfil",
  robots: { index: false, follow: false },
};

export default function PerfilPage() {
  return <PerfilContenido />;
}

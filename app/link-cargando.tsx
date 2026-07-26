"use client";

import { useLinkStatus } from "next/link";

/**
 * Punto que late junto al enlace pulsado mientras la navegación tarda.
 *
 * El mismo patrón que el menú del admin (nav-links.tsx): useLinkStatus da
 * el estado pendiente del <Link> ancestro, y el retraso de 100 ms vive en
 * el CSS (.link-hint) para que una navegación rápida no lo llegue a
 * enseñar. Va en fichero propio porque aquí lo usan un server component
 * (el pie de la portada) y un client component (la barra inferior).
 */
export default function LinkCargando() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-hint ${pending ? "is-pending" : ""}`} />;
}

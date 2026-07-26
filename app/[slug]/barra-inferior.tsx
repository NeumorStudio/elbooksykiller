"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LinkCargando from "@/app/link-cargando";

/**
 * Barra de navegación inferior, solo en la app instalada.
 *
 * En el navegador sobra: ya está la barra del sistema con su botón atrás.
 * Instalada como PWA no hay ninguna, y el cliente que entra al flujo de
 * reserva se queda sin salida — de ahí los dos destinos fijos.
 *
 * «Inicio» navega con <a> y no con <Link> a propósito: queremos recarga
 * completa. Reinicia el estado del widget (servicio, profesional, hora) y
 * sale del modo reserva, que va por :target sobre #reservar.
 */
export default function BarraInferior({ slug }: { slug: string }) {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
    const calc = () => setStandalone(mq.matches || !!iosStandalone);
    calc();
    // En iOS se puede pasar de pestaña a app sin recargar.
    mq.addEventListener("change", calc);
    return () => mq.removeEventListener("change", calc);
  }, []);

  if (!standalone) return null;

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md">
        {/* active:scale responde en el mismo frame del toque — es lo único
            que de verdad quita la duda de «¿le he dado?» mientras carga. */}
        <a
          href={`/${slug}`}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs text-muted
            transition-[color,transform] duration-150 active:scale-90 hover:text-brand
            focus-visible:outline-2
            focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <span aria-hidden className="text-lg leading-none">
            ⌂
          </span>
          Inicio
        </a>
        {/* /[slug]/perfil y no /perfil: el manifest declara scope "/[slug]",
            y salirse de él saca al usuario de la app instalada.
            <Link> y no <a>: la recarga completa dejaba segundos en blanco
            sin ninguna señal; en cliente el esqueleto de loading.tsx entra
            al momento y el punto late si aun así tarda. */}
        <Link
          href={`/${slug}/perfil`}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs text-muted
            transition-[color,transform] duration-150 active:scale-90 hover:text-brand
            focus-visible:outline-2
            focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <span aria-hidden className="text-lg leading-none">
            ◍
          </span>
          {/* pl-[0.8rem]: el punto de carga mide 0.4rem + 0.4rem de margen y
              está siempre presente aunque invisible (así no mueve el texto al
              aparecer); este padding lo equilibra para que «Mi cuenta» quede
              centrado bajo el icono. */}
          <span className="flex items-center pl-[0.8rem]">
            Mi cuenta
            <LinkCargando />
          </span>
        </Link>
      </div>
    </nav>
  );
}

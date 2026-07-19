"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Carrusel de trabajos. Avanza solo cada 4 s, pero el scroll nativo manda:
 * si el usuario toca, el automático se para para siempre — arrebatarle el
 * control es el pecado clásico de este componente.
 *
 * El desplazamiento usa scrollTo del contenedor (no transform), así que el
 * gesto táctil y el momentum de iOS siguen funcionando igual.
 */
export default function Carrusel({
  fotos,
  alt,
}: {
  fotos: string[];
  alt: string;
}) {
  const pista = useRef<HTMLDivElement>(null);
  const [activa, setActiva] = useState(0);
  const [autoOn, setAutoOn] = useState(true);

  // Índice visible según la posición de scroll, para los puntos.
  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const hijo = el.firstElementChild as HTMLElement | null;
        if (!hijo) return;
        const paso = hijo.offsetWidth + 12; // ancho + gap
        setActiva(Math.round(el.scrollLeft / paso));
      }, 90);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!autoOn || fotos.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = setInterval(() => {
      const el = pista.current;
      if (!el) return;
      const hijo = el.firstElementChild as HTMLElement | null;
      if (!hijo) return;
      const paso = hijo.offsetWidth + 12;
      const finDeRecorrido = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: finDeRecorrido ? 0 : el.scrollLeft + paso, behavior: "smooth" });
    }, 4000);
    return () => clearInterval(id);
  }, [autoOn, fotos.length]);

  const parar = () => setAutoOn(false);

  return (
    <div>
      <div
        ref={pista}
        onPointerDown={parar}
        onWheel={parar}
        onKeyDown={parar}
        className="flex gap-3 overflow-x-auto px-5 pb-4 snap-x snap-mandatory fade-x"
        style={{ scrollPaddingInline: "1.25rem", scrollbarWidth: "none" }}
        role="group"
        aria-label="Trabajos del salón"
      >
        {fotos.map((src, i) => (
          <figure
            key={src}
            className="neu shrink-0 snap-start overflow-hidden rounded-2xl p-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${alt} — trabajo ${i + 1}`}
              loading={i < 2 ? "eager" : "lazy"}
              decoding="async"
              className="h-72 w-56 rounded-xl object-cover sm:h-80 sm:w-64"
            />
          </figure>
        ))}
      </div>

      {fotos.length > 1 && (
        <div className="mt-1 flex justify-center gap-2" aria-hidden>
          {fotos.map((src, i) => (
            <span
              key={src}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === activa ? "w-6 bg-brand" : "w-1.5 bg-line-strong"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

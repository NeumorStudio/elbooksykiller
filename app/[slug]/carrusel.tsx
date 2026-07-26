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
  const pastilla = useRef<HTMLSpanElement>(null);
  const [autoOn, setAutoOn] = useState(true);

  /**
   * La pastilla naranja sigue al dedo.
   *
   * Antes iba con un `setTimeout` de 90 ms que se reiniciaba en cada evento
   * de scroll: mientras arrastrabas, el temporizador no llegaba a cumplirse
   * nunca, así que el indicador **no se movía en absoluto** hasta que
   * soltabas. Luego encima animaba 300 ms. De ahí la sensación de ir a
   * remolque.
   *
   * Ahora la posición se calcula en cada frame con requestAnimationFrame y
   * se escribe directa en el DOM. Sin estado de React de por medio: un
   * re-render por frame para mover un punto es tirar trabajo, y es
   * justamente lo que vuelve a introducir retraso en un móvil modesto.
   *
   * La posición es fraccionaria, no el índice redondeado: a media pasada
   * entre dos fotos la pastilla está a medio camino, que es lo que hace que
   * parezca pegada al gesto en vez de saltar.
   */
  useEffect(() => {
    const el = pista.current;
    if (!el || fotos.length < 2) return;
    let frame = 0;

    const pintar = () => {
      frame = 0;
      const p = pastilla.current;
      const hijo = el.firstElementChild as HTMLElement | null;
      if (!p || !hijo) return;
      const paso = hijo.offsetWidth + 12; // ancho de la foto + gap-3
      const avance = Math.min(Math.max(el.scrollLeft / paso, 0), fotos.length - 1);
      // PASO_PUNTOS: punto (6px) + gap-2 (8px). CENTRADO: la pastilla mide
      // 24px y hay que centrarla sobre un punto de 6.
      p.style.transform = `translate3d(${avance * 14 - 9}px,0,0)`;
    };

    const onScroll = () => {
      // Coalescer a un cálculo por frame: el scroll dispara muchos más
      // eventos que frames tiene la pantalla.
      if (!frame) frame = requestAnimationFrame(pintar);
    };

    pintar();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", pintar);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", pintar);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fotos.length]);

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
        <div className="mt-1 flex justify-center" aria-hidden>
          {/* Los puntos son la pista; la pastilla naranja se desliza por
              encima. Antes el punto activo se ensanchaba en su sitio, lo que
              obligaba a esperar a saber CUÁL era el activo — y por eso solo
              podía moverse a saltos, al terminar el gesto. */}
          <div className="relative flex gap-2">
            {fotos.map((src) => (
              <span key={src} className="h-1.5 w-1.5 rounded-full bg-line-strong" />
            ))}
            <span
              ref={pastilla}
              // Sin transition: sigue al scroll fotograma a fotograma, y una
              // animación encima solo añadiría el retraso que quitamos.
              className="pointer-events-none absolute left-0 top-0 h-1.5 w-6 rounded-full bg-brand will-change-transform"
            />
          </div>
        </div>
      )}
    </div>
  );
}

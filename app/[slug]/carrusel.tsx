"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const sinMovimiento = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Cambio de estado envuelto en View Transitions: el navegador fotografía el
 * antes y el después y morphea lo que comparta `view-transition-name`.
 *
 * flushSync no es opcional: sin él React pinta en el siguiente tick, o sea
 * después de que el navegador ya haya sacado la foto del estado nuevo, y no
 * hay morph. Donde no existe la API (Firefox viejo, Safari <18) el estado
 * cambia igual y solo se pierde la animación.
 */
function conMorph(cambio: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (!doc.startViewTransition || sinMovimiento()) return cambio();
  doc.startViewTransition(() => flushSync(cambio));
}

/**
 * Carrusel de trabajos. Avanza solo cada 4 s, pero el scroll nativo manda:
 * si el usuario toca, el automático se para para siempre — arrebatarle el
 * control es el pecado clásico de este componente.
 *
 * El desplazamiento usa scrollTo del contenedor (no transform), así que el
 * gesto táctil y el momentum de iOS siguen funcionando igual.
 *
 * Al pulsar una foto se abre a pantalla completa en un <dialog> nativo, que
 * trae gratis lo que un div fijo obliga a escribir a mano: Esc, foco
 * atrapado, fondo inerte y ::backdrop.
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
  const visor = useRef<HTMLDialogElement>(null);
  const [autoOn, setAutoOn] = useState(true);
  // `foco` es la miniatura que lleva el view-transition-name; `abierta`, si el
  // visor está puesto. Hacen falta las dos: al abrir, el nombre tiene que
  // estar YA en la miniatura antes de que arranque la transición.
  const [foco, setFoco] = useState(0);
  const [abierta, setAbierta] = useState<number | null>(null);

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
      const avance = Math.min(
        Math.max(el.scrollLeft / paso, 0),
        fotos.length - 1,
      );
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
    if (!autoOn || fotos.length < 2 || abierta !== null) return;
    if (sinMovimiento()) return;

    const id = setInterval(() => {
      const el = pista.current;
      if (!el) return;
      const hijo = el.firstElementChild as HTMLElement | null;
      if (!hijo) return;
      const paso = hijo.offsetWidth + 12;
      const finDeRecorrido =
        el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({
        left: finDeRecorrido ? 0 : el.scrollLeft + paso,
        behavior: "smooth",
      });
    }, 4000);
    return () => clearInterval(id);
  }, [autoOn, fotos.length, abierta]);

  // showModal() tiene que correr dentro del mismo commit síncrono que abre el
  // visor, de ahí useLayoutEffect: con useEffect llega tarde a la transición.
  useLayoutEffect(() => {
    const d = visor.current;
    if (!d) return;
    if (abierta !== null && !d.open) d.showModal();
    if (abierta === null && d.open) d.close();
  }, [abierta]);

  const parar = () => setAutoOn(false);

  const abrir = (i: number) => {
    parar();
    flushSync(() => setFoco(i)); // la miniatura coge el nombre antes del morph
    conMorph(() => setAbierta(i));
  };

  const cerrar = () => {
    // Volver al carrusel por donde se salió: si no, el morph de cierre apunta
    // a una miniatura que está fuera de pantalla y la foto se va a la nada.
    const hijo = pista.current?.children[foco] as HTMLElement | undefined;
    hijo?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
    conMorph(() => setAbierta(null));
  };

  const navegar = (paso: number) => {
    if (abierta === null) return;
    const i = (abierta + paso + fotos.length) % fotos.length;
    conMorph(() => {
      setAbierta(i);
      setFoco(i);
    });
  };

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
            <button
              type="button"
              onClick={() => abrir(i)}
              aria-label={`Ver más grande: ${alt} — trabajo ${i + 1}`}
              className="block cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${alt} — trabajo ${i + 1}`}
                loading={i < 2 ? "eager" : "lazy"}
                decoding="async"
                className="h-72 w-56 rounded-xl object-cover sm:h-80 sm:w-64"
                style={
                  i === foco && abierta === null
                    ? { viewTransitionName: "foto-visor" }
                    : undefined
                }
              />
            </button>
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
              <span
                key={src}
                className="h-1.5 w-1.5 rounded-full bg-line-strong"
              />
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

      <dialog
        ref={visor}
        className="visor"
        aria-label="Foto ampliada"
        // Clic en el hueco (el propio dialog, no la foto) = cerrar.
        onClick={(e) => {
          if (e.target === visor.current) cerrar();
        }}
        // Esc lo cierra el navegador de golpe; lo interceptamos para que
        // también salga con morph.
        onCancel={(e) => {
          e.preventDefault();
          cerrar();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") navegar(1);
          if (e.key === "ArrowLeft") navegar(-1);
        }}
      >
        {abierta !== null && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fotos[abierta]}
              alt={`${alt} — trabajo ${abierta + 1}`}
              className="max-h-[86dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
              style={{ viewTransitionName: "foto-visor" }}
            />

            {/* Los controles van juntos en una capa con su propio nombre de
                transición: entran fundiéndose un pelo DESPUÉS de que la foto
                haya crecido, en vez de aparecer de golpe a media animación. */}
            <div
              className="visor-controles"
              style={{ viewTransitionName: "visor-controles" }}
            >
              <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar"
                className="visor-btn absolute right-4 top-4"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {fotos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => navegar(-1)}
                    aria-label="Foto anterior"
                    className="visor-btn absolute left-4 top-1/2 -translate-y-1/2"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                      <path
                        d="M15 5l-7 7 7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => navegar(1)}
                    aria-label="Foto siguiente"
                    className="visor-btn absolute right-4 top-1/2 -translate-y-1/2"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                      <path
                        d="M9 5l7 7-7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <p className="visor-contador">
                    {abierta + 1} / {fotos.length}
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

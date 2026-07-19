"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Vídeo ambiental de fondo. Decoración pura: si no se reproduce, el póster
 * se queda y no se nota.
 *
 * El LCP es el póster, nunca el vídeo: el `src` no está en el HTML inicial
 * y solo se asigna cuando la página ya cargó, así que no compite por ancho
 * de banda con lo que el usuario necesita ver.
 *
 * Se abstiene de cargar (no solo de reproducir — si no, ya te has bajado
 * los 200 KB) cuando: hay preferencia de movimiento reducido, el usuario
 * pidió ahorro de datos, o la conexión no es 4G.
 */
export default function VideoFondo({
  mp4,
  webm,
  poster,
  className = "",
}: {
  mp4: string;
  webm?: string;
  poster: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [cargar, setCargar] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && !conn.effectiveType.includes("4g")) return;

    const arrancar = () => setCargar(true);
    const diferir = () =>
      "requestIdleCallback" in window
        ? requestIdleCallback(arrancar, { timeout: 2000 })
        : setTimeout(arrancar, 300);

    if (document.readyState === "complete") diferir();
    else window.addEventListener("load", diferir, { once: true });
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!cargar || !v) return;
    // React no siempre serializa `muted` al HTML, y Safari evalúa el
    // autoplay en el primer frame: hay que forzarlo por propiedad.
    v.muted = true;
    v.play().catch(() => {
      /* Modo de bajo consumo en iOS: nos quedamos con el póster. */
    });
  }, [cargar]);

  return (
    <video
      ref={ref}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      tabIndex={-1}
      className={className}
    >
      {cargar && webm && <source src={webm} type="video/webm; codecs=vp9" />}
      {cargar && <source src={mp4} type="video/mp4; codecs=avc1.4d401f" />}
    </video>
  );
}

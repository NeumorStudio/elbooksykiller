"use client";

import { useEffect, useState } from "react";

type BipEvent = Event & { prompt: () => Promise<void> };

/**
 * Instalación del panel como app. Hermano de app/[slug]/install-prompt.tsx
 * (la web del cliente), pero con dos diferencias que obligan a separarlo:
 * aquí hay DOS puntos de entrada —el aviso automático y el botón de «Mi
 * web»— y el navegador solo dispara `beforeinstallprompt` UNA vez.
 *
 * Por eso el evento se guarda a nivel de módulo y los dos componentes se
 * suscriben: si el aviso lo captura y el dueño lo cierra, el botón sigue
 * pudiendo instalar.
 */
let diferido: BipEvent | null = null;
const suscriptores = new Set<() => void>();

function avisar() {
  suscriptores.forEach((f) => f());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    diferido = e as BipEvent;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    diferido = null;
    avisar();
  });
}

function yaInstalada() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as unknown as { standalone?: boolean }).standalone
  );
}

/** iPadOS 13+ se presenta como Macintosh: sin maxTouchPoints no se detecta. */
function entornoIos() {
  const ua = navigator.userAgent;
  const esIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // En iOS solo Safari puede añadir a pantalla de inicio.
  const esSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  return { esIos, esSafari };
}

/** Estado compartido: si se puede instalar y cómo. */
function useInstalacion() {
  const [puede, setPuede] = useState(false);
  const [ios, setIos] = useState({ esIos: false, esSafari: true });
  const [instalada, setInstalada] = useState(true); // pesimista hasta montar

  useEffect(() => {
    const sync = () => setPuede(!!diferido);
    suscriptores.add(sync);
    sync();
    setIos(entornoIos());
    setInstalada(yaInstalada());
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => {
      suscriptores.delete(sync);
    };
  }, []);

  const instalar = async () => {
    if (!diferido) return;
    await diferido.prompt();
    diferido = null;
    avisar();
  };

  return { puede, instalar, ...ios, instalada };
}

const CLAVE = "pwa-no-admin";

/** Aviso automático la primera vez que se entra desde una tablet o móvil. */
export function AvisoInstalar() {
  const { puede, instalar, esIos, esSafari, instalada } = useInstalacion();
  const [cerrado, setCerrado] = useState(true);

  useEffect(() => {
    // Aparece a los 3 s: entrar y que te salte un cartel encima es hostil,
    // y el dueño suele venir a mirar la agenda, no a instalar nada.
    const t = setTimeout(() => {
      try {
        if (Date.now() < Number(localStorage.getItem(CLAVE) ?? 0)) return;
      } catch {}
      setCerrado(false);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  function cerrar() {
    try {
      localStorage.setItem(CLAVE, String(Date.now() + 30 * 86400000));
    } catch {}
    setCerrado(true);
  }

  if (instalada || cerrado) return null;
  // En escritorio sin prompt nativo no hay nada que ofrecer.
  if (!puede && !esIos) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar el panel"
      className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-md panel bg-surface p-4 shadow-xl flex items-start gap-3"
    >
      <span
        aria-hidden
        className="w-11 h-11 shrink-0 rounded-xl bg-bg text-brand font-display font-bold text-xl
          inline-flex items-center justify-center border border-line"
      >
        S
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">Ten tu agenda a un toque</p>
        <p className="text-sm text-muted mt-0.5 text-pretty">
          {puede
            ? "Instala el panel y ábrelo como una app, sin buscar la dirección cada vez."
            : esSafari
              ? <>Toca <b>Compartir</b> <span aria-hidden>⎋</span> y luego <b>«Añadir a pantalla de inicio»</b>.</>
              : <>Ábrelo en <b>Safari</b> para añadirlo a tu pantalla de inicio: en este navegador iOS no lo permite.</>}
        </p>
        {puede && (
          <button onClick={() => { instalar(); cerrar(); }} className="btn-primary mt-3 text-sm w-full">
            Instalar
          </button>
        )}
      </div>
      <button
        onClick={cerrar}
        aria-label="Cerrar"
        className="text-muted hover:text-ink min-h-11 min-w-11 rounded-lg shrink-0 -mr-2 -mt-1"
      >
        ×
      </button>
    </div>
  );
}

/** Botón de «Mi web», por si el aviso se cerró o nunca llegó a salir. */
export function BotonInstalar() {
  const { puede, instalar, esIos, esSafari, instalada } = useInstalacion();

  if (instalada) {
    return (
      <p className="text-sm text-ok">✓ Ya tienes el panel instalado en este dispositivo.</p>
    );
  }
  if (puede) {
    return (
      <button onClick={instalar} className="btn-primary text-sm self-start">
        Instalar el panel
      </button>
    );
  }
  if (esIos) {
    return (
      <p className="text-sm text-muted text-pretty">
        {esSafari ? (
          <>Toca <b>Compartir</b> <span aria-hidden>⎋</span> abajo y luego{" "}
          <b>«Añadir a pantalla de inicio»</b>.</>
        ) : (
          <>Abre esta página en <b>Safari</b> para poder añadirla a tu pantalla
          de inicio: en este navegador iOS no lo permite.</>
        )}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted text-pretty">
      Desde este navegador no se puede instalar. Ábrelo en Chrome en tu móvil o
      tablet, o usa el menú del navegador → «Instalar aplicación».
    </p>
  );
}

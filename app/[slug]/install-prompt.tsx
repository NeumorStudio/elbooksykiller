"use client";

import { useEffect, useRef, useState } from "react";

type BipEvent = Event & { prompt: () => Promise<void> };

// Banner de instalación PWA: prompt nativo en Android/Chrome,
// instrucciones de "Añadir a pantalla de inicio" en iOS.
export default function InstallPrompt({
  slug,
  salonName,
  logoUrl,
}: {
  slug: string;
  salonName: string;
  logoUrl?: string | null;
}) {
  const [mode, setMode] = useState<"hidden" | "android" | "ios" | "ios-otro">("hidden");
  const deferred = useRef<BipEvent | null>(null);

  useEffect(() => {
    // El service worker se registra en el script en línea de page.tsx, no
    // aquí: hidratar es demasiado tarde para que Chrome dé la web por
    // instalable en la primera visita.

    // Ya instalada, o despedida hace menos de 30 días: no molestar
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return;
    try {
      const until = Number(localStorage.getItem(`pwa-no-${slug}`) ?? 0);
      if (Date.now() < until) return;
    } catch {}

    const snoozed = () => {
      try {
        return Date.now() < Number(localStorage.getItem(`pwa-no-${slug}`) ?? 0);
      } catch {
        return false;
      }
    };
    const onBip = (e: Event) => {
      e.preventDefault();
      if (snoozed()) return;
      deferred.current = e as BipEvent;
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    // El evento pudo dispararse antes de hidratar: lo aparca el script en
    // línea de page.tsx, porque después ya no hay forma de recuperarlo.
    const previo = (window as unknown as { __bip?: BipEvent }).__bip;
    if (previo) onBip(previo);

    const ua = navigator.userAgent;
    // iPadOS 13+ se identifica como Macintosh: sin maxTouchPoints, ningún
    // iPad moderno veía nunca estas instrucciones.
    const esIos =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    // Solo Safari puede añadir a pantalla de inicio en iOS. En Chrome,
    // Firefox o Edge no hay opción: en vez de callar, se explica.
    const esSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);

    const t = esIos
      ? setTimeout(() => setMode(esSafari ? "ios" : "ios-otro"), 2500)
      : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      if (t) clearTimeout(t);
    };
  }, [slug]);

  function dismiss() {
    try {
      localStorage.setItem(`pwa-no-${slug}`, String(Date.now() + 30 * 86400000));
    } catch {}
    setMode("hidden");
  }

  async function install() {
    const e = deferred.current;
    if (!e) return;
    await e.prompt();
    dismiss();
  }

  if (mode === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar aplicación"
      className="fixed bottom-4 inset-x-4 z-30 mx-auto max-w-md panel bg-surface p-4 shadow-xl flex items-start gap-3"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="w-11 h-11 shrink-0 rounded-xl object-contain bg-bg border border-line p-0.5"
        />
      ) : (
        <span
          aria-hidden
          className="w-11 h-11 shrink-0 rounded-xl bg-bg text-brand font-display font-bold text-xl
            inline-flex items-center justify-center border border-line"
        >
          {salonName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{salonName}, como una app</p>
        {mode === "android" && (
          <p className="text-sm text-muted mt-0.5 text-pretty">
            Instálala y reserva en dos toques la próxima vez.
          </p>
        )}
        {mode === "ios" && (
          <p className="text-sm text-muted mt-0.5 text-pretty">
            Toca <b>Compartir</b> <span aria-hidden>⎋</span> y luego{" "}
            <b>«Añadir a pantalla de inicio»</b>.
          </p>
        )}
        {mode === "ios-otro" && (
          <p className="text-sm text-muted mt-0.5 text-pretty">
            Ábrela en <b>Safari</b> para añadirla a tu pantalla de inicio: en
            este navegador iOS no lo permite.
          </p>
        )}
        {mode === "android" && (
          <button onClick={install} className="btn-primary mt-3 text-sm w-full">
            Instalar
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Cerrar"
        className="text-muted hover:text-ink min-h-11 min-w-11 rounded-lg shrink-0 -mr-2 -mt-1"
      >
        ×
      </button>
    </div>
  );
}

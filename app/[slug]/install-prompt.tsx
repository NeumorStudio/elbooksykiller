"use client";

import { useEffect, useRef, useState } from "react";

type BipEvent = Event & { prompt: () => Promise<void> };

// Banner de instalación PWA: prompt nativo en Android/Chrome,
// instrucciones de "Añadir a pantalla de inicio" en iOS.
export default function InstallPrompt({
  slug,
  salonName,
}: {
  slug: string;
  salonName: string;
}) {
  const [mode, setMode] = useState<"hidden" | "android" | "ios">("hidden");
  const deferred = useRef<BipEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

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

    const isIos =
      /iPhone|iPad|iPod/.test(navigator.userAgent) &&
      !/CriOS|FxiOS/.test(navigator.userAgent);
    const t = isIos ? setTimeout(() => setMode("ios"), 2500) : undefined;

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
      <span
        aria-hidden
        className="w-11 h-11 shrink-0 rounded-xl bg-bg text-brand font-display font-bold text-xl
          inline-flex items-center justify-center border border-line"
      >
        {salonName.charAt(0).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{salonName}, como una app</p>
        {mode === "android" ? (
          <p className="text-sm text-muted mt-0.5 text-pretty">
            Instálala y reserva en dos toques la próxima vez.
          </p>
        ) : (
          <p className="text-sm text-muted mt-0.5 text-pretty">
            Toca <b>Compartir</b> <span aria-hidden>⎋</span> y luego{" "}
            <b>«Añadir a pantalla de inicio»</b>.
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

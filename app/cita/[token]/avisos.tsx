"use client";

import { useEffect, useState } from "react";
import { guardarPush } from "./actions";

/**
 * «Avísame en el móvil»: activa el recordatorio de 1 hora por notificación.
 *
 * Se ofrece aquí y no en el widget de reserva porque el permiso hay que
 * pedirlo en el momento en que se entiende para qué sirve. Pedirlo nada más
 * entrar en la web es la forma más rápida de que lo denieguen para siempre
 * —y una vez denegado, el navegador no vuelve a preguntar—.
 *
 * En iOS solo existe si la web está instalada en la pantalla de inicio;
 * Safari no expone pushManager fuera de la app instalada. Por eso, cuando
 * no está disponible, se explica cómo instalar en vez de esconder el botón:
 * el cliente que quiere el aviso puede conseguirlo.
 */
export default function Avisos({
  token,
  claveVapid,
}: {
  token: string;
  claveVapid: string;
}) {
  const [estado, setEstado] = useState<
    "cargando" | "no-soportado" | "instalar" | "listo" | "activo" | "denegado" | "yendo"
  >("cargando");
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const soportado =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!soportado) {
        // iPhone en Safari sin instalar: es el caso, no un navegador raro.
        const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (vivo) setEstado(esIOS ? "instalar" : "no-soportado");
        return;
      }
      if (Notification.permission === "denied") {
        if (vivo) setEstado("denegado");
        return;
      }
      try {
        // getRegistration() y no .ready: .ready se queda colgada para siempre
        // si la página no tiene SW registrado — y quien llega por el enlace
        // del email no lo tiene, así que el botón no aparecía nunca.
        const reg = await navigator.serviceWorker.getRegistration();
        const ya = reg ? await reg.pushManager.getSubscription() : null;
        if (vivo) setEstado(ya ? "activo" : "listo");
      } catch {
        if (vivo) setEstado("listo");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function activar() {
    setError("");
    setEstado("yendo");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "denegado" : "listo");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(claveVapid),
        }));

      const r = await guardarPush(token, JSON.parse(JSON.stringify(sub)));
      if (r.error) {
        setError(r.error);
        setEstado("listo");
        return;
      }
      setEstado("activo");
    } catch (e) {
      setError("No se pudo activar. Inténtalo de nuevo.");
      setEstado("listo");
      console.error(e);
    }
  }

  if (estado === "cargando" || estado === "no-soportado") return null;

  if (estado === "activo") {
    return (
      <p className="text-sm text-ok text-center">
        ✓ Te avisaremos en este móvil una hora antes.
      </p>
    );
  }

  if (estado === "denegado") {
    return (
      <p className="text-sm text-muted text-center text-pretty">
        Tienes las notificaciones bloqueadas para esta web. Puedes permitirlas
        desde los ajustes del navegador si quieres el aviso.
      </p>
    );
  }

  if (estado === "instalar") {
    return (
      <p className="text-sm text-muted text-center text-pretty">
        Para recibir el aviso en el móvil, añade esta web a tu pantalla de
        inicio: toca <b className="text-ink">Compartir</b> y luego{" "}
        <b className="text-ink">Añadir a inicio</b>.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={activar}
        disabled={estado === "yendo"}
        className="btn-quiet text-sm disabled:opacity-60"
      >
        {estado === "yendo" ? "Activando…" : "Avisarme en el móvil"}
      </button>
      <p className="text-xs text-muted text-center text-pretty">
        Una sola notificación, una hora antes de tu cita. Nada más.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * La clave VAPID viaja en base64url y `subscribe` exige bytes. atob() no
 * entiende `-` ni `_`, así que hay que traducirlos antes o la suscripción
 * falla con un error que no dice nada.
 */
function base64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normal);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

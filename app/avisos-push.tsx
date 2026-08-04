"use client";

import { useEffect, useState } from "react";

/**
 * «Avísame en el móvil»: pide el permiso, suscribe el navegador y guarda.
 *
 * El permiso hay que pedirlo en el momento en que se entiende para qué
 * sirve. Pedirlo nada más entrar en una web es la forma más rápida de que lo
 * denieguen para siempre —y una vez denegado, el navegador no vuelve a
 * preguntar—. Por eso esto no se pinta solo: lo coloca quien sabe que el
 * usuario acaba de hacer algo que da sentido al aviso (reservar una cita,
 * abrir su panel).
 *
 * En iOS solo existe si la web está instalada en la pantalla de inicio;
 * Safari no expone pushManager fuera de la app instalada. Por eso, cuando no
 * está disponible, se explica cómo instalar en vez de esconder el botón: el
 * que quiere el aviso puede conseguirlo.
 *
 * `guardar` es una server action que le pasa quien monta el componente: la
 * del cliente exige el token de su cita, la del dueño su sesión. Así cada
 * zona referencia solo su propia acción.
 */
export type Suscripcion = { endpoint: string; keys: { p256dh: string; auth: string } };

export default function AvisosPush({
  claveVapid,
  guardar,
  textoBoton = "Avisarme en el móvil",
  textoAyuda,
  textoActivo,
  autoActivar = false,
}: {
  claveVapid: string;
  guardar: (sub: Suscripcion) => Promise<{ error?: string }>;
  textoBoton?: string;
  textoAyuda: string;
  textoActivo: string;
  /**
   * Lanza la petición de permiso sola, sin esperar a que pulse el botón.
   *
   * Solo tiene sentido para quien no ha dejado email: ahí el aviso en el
   * móvil no es un extra, es el único canal que queda, y hacerle pulsar un
   * botón más es perder a la mitad. Se encadena al clic de confirmar la
   * reserva, que es el gesto que los navegadores piden para dejar preguntar.
   *
   * Para quien SÍ dio su correo no se usa a propósito: si dice que no, el
   * navegador no vuelve a preguntar nunca más en este dominio, y habríamos
   * quemado el canal de todas sus citas futuras para nada.
   */
  autoActivar?: boolean;
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
        if (!vivo) return;
        if (ya) {
          setEstado("activo");
          return;
        }
        setEstado("listo");
        // El permiso ya concedido en una visita anterior no vuelve a
        // preguntar: se suscribe directamente, sin diálogo ni botón.
        if (autoActivar || Notification.permission === "granted") activar();
      } catch {
        if (vivo) setEstado("listo");
      }
    })();
    return () => {
      vivo = false;
    };
    // Solo al montar: `activar` no cambia entre renders de forma relevante y
    // reintentar la petición de permiso en cada uno sería justo lo contrario
    // de lo que hace falta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      const r = await guardar(JSON.parse(JSON.stringify(sub)) as Suscripcion);
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
    return <p className="text-sm text-ok text-center">✓ {textoActivo}</p>;
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
        {estado === "yendo" ? "Activando…" : textoBoton}
      </button>
      <p className="text-xs text-muted text-center text-pretty">{textoAyuda}</p>
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
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(normal);
  // Sin anotar el tipo de vuelta a propósito: anotarlo `Uint8Array` lo tipa
  // sobre ArrayBufferLike y deja de encajar en `applicationServerKey`.
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

// Service worker: instalabilidad PWA y notificaciones push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Sin manejador de `fetch` Chrome no marca la PWA como instalable: no
 * dispara `beforeinstallprompt` y el banner de Android no aparecía nunca.
 * iOS no usa ese evento —va por su propio aviso— y por eso el iPhone sí
 * enseñaba la guía: el fallo se veía solo en Android.
 *
 * ponytail: no es una caché, es la respuesta de cortesía sin red. Cachear
 * de verdad cuando alguien pida que la app abra offline.
 */
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          `<!doctype html><meta charset="utf-8">
           <meta name="viewport" content="width=device-width,initial-scale=1">
           <title>Sin conexión</title>
           <p style="font:16px/1.5 system-ui;padding:2rem;color:#1b1712">
             Sin conexión. Inténtalo otra vez cuando tengas red.</p>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
    )
  );
});

/**
 * Recordatorio de la cita.
 *
 * El payload llega cifrado desde el servidor; aquí solo se pinta. Si no se
 * puede leer se enseña un aviso genérico en vez de tragarse el evento: los
 * navegadores penalizan —y algunos acaban revocando el permiso— cuando
 * llega un push y no se muestra ninguna notificación.
 */
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  const titulo = d.titulo || "Tienes una cita";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: d.cuerpo || "",
      icon: d.icono || undefined,
      badge: d.icono || undefined,
      // Reemplaza en vez de apilar: dos recordatorios de la misma cita en la
      // barra son ruido, no información.
      tag: d.tag || "cita",
      renotify: true,
      data: { url: d.url || "/" },
    })
  );
});

/**
 * Al tocar la notificación: si la web ya está abierta se trae al frente en
 * vez de abrir otra pestaña — acabar con cinco copias de la misma cita es la
 * forma más rápida de que alguien desinstale la app.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes(destino) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});

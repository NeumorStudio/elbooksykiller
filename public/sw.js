// Service worker: instalabilidad PWA y notificaciones push.
// ponytail: sin caché offline; la reserva necesita red igualmente.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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

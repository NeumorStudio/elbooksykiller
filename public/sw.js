// Service worker mínimo para la instalabilidad PWA.
// ponytail: sin caché offline; la reserva necesita red igualmente.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

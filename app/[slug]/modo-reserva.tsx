"use client";

import { useEffect } from "react";

/**
 * Marca el «modo reserva» con un atributo en <html>.
 *
 * La primera versión iba solo con :target sobre #reservar. Funciona, pero
 * depende de que el fragmento sobreviva en la URL, y no siempre lo hace:
 * una server action con revalidatePath, un refresco del router o un
 * arranque en frío de la PWA lo pierden. El síntoma es que el escaparate
 * reaparece en mitad de la reserva.
 *
 * El atributo vive en documentElement, fuera del árbol de React, así que
 * ningún re-render lo toca. La regla :target se mantiene en CSS como
 * refuerzo para quien tenga JS desactivado.
 */
export default function ModoReserva() {
  useEffect(() => {
    const raiz = document.documentElement;
    const activar = () => raiz.setAttribute("data-reserva", "");
    const sincronizar = () => {
      if (location.hash === "#reservar") activar();
      else raiz.removeAttribute("data-reserva");
    };

    // Al pulsar el CTA: inmediato, sin esperar al hashchange.
    const alPulsar = (e: MouseEvent) => {
      const destino = (e.target as Element | null)?.closest?.('a[href="#reservar"]');
      if (destino) activar();
    };

    sincronizar();
    document.addEventListener("click", alPulsar, true);
    // popstate además de hashchange: el botón atrás sale del modo.
    window.addEventListener("hashchange", sincronizar);
    window.addEventListener("popstate", sincronizar);

    return () => {
      document.removeEventListener("click", alPulsar, true);
      window.removeEventListener("hashchange", sincronizar);
      window.removeEventListener("popstate", sincronizar);
    };
  }, []);

  return null;
}

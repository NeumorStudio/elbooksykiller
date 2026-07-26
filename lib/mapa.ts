/**
 * Enlace de «cómo llegar» a partir de la dirección del salón.
 *
 * **Sin el nombre del negocio, a propósito.** Incluirlo hace que Google
 * busque una FICHA de empresa; si el salón no está dado de alta en Google
 * Business —el caso de uno que acaba de abrir— no encuentra ninguna y cae en
 * el resultado más parecido, que puede ser otro local con nombre similar y
 * en otra ciudad. Con la dirección sola geocodifica calle y portal, que es
 * exactamente lo que necesita quien va a venir.
 *
 * El día que el salón tenga ficha en Google, buscar por nombre daría un
 * resultado algo mejor (foto, horario, reseñas). No compensa: acertar la
 * calle siempre vale más que acertar la ficha a veces.
 *
 * `/maps/search/?api=1` es el formato documentado por Google y el estable:
 * en el móvil abre la app de Maps en lugar del navegador.
 */
export const mapaUrl = (direccion: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;

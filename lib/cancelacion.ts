/**
 * Cuánta antelación hace falta para cancelar desde el enlace de la cita.
 *
 * El número vivía escrito a mano en dos sitios —la action que cancela y la
 * página que decide si pinta el botón—, y tenían que decir lo mismo sin que
 * nada lo garantizase. Descuadrarlos no daba error: dejaba el botón a la
 * vista para que al pulsarlo saltara «llama al salón», que es justo la
 * frustración que el botón venía a evitar.
 *
 * Por debajo de este margen el hueco ya no se recoloca —nadie reserva un
 * corte para dentro de media hora—, así que cancelar deja la silla vacía
 * igual: a esas alturas se habla por teléfono, que además da opción a mover
 * la cita en vez de perderla.
 *
 * Es una regla de plataforma, no por salón. Si algún día un salón necesita
 * la suya, esto pasa a ser el valor por defecto de una columna en `salons`.
 */
export const MARGEN_CANCELACION_MIN = 60;

const MS = MARGEN_CANCELACION_MIN * 60_000;

/**
 * El plazo en palabras, para que ningún aviso prometa un margen distinto
 * del que aplica el servidor.
 */
export const MARGEN_CANCELACION_TEXTO =
  MARGEN_CANCELACION_MIN === 60
    ? "1 hora"
    : MARGEN_CANCELACION_MIN % 60 === 0
      ? `${MARGEN_CANCELACION_MIN / 60} horas`
      : `${MARGEN_CANCELACION_MIN} minutos`;

/** ¿Le queda margen a esta cita para cancelarse sola, sin llamar? */
export function sePuedeCancelar(startsAt: string | Date, ahora: number = Date.now()) {
  const inicio = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  return inicio.getTime() - ahora > MS;
}

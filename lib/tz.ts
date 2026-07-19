/**
 * Desfase de una zona horaria respecto a UTC, en minutos, para un instante
 * dado.
 *
 * Usa `formatToParts` y no el truco de `toLocaleString("en-US")`: ese
 * depende de que la cadena resultante sea parseable por `new Date()`, y en
 * los días de cambio de hora (una hora local que se repite o que no existe)
 * da resultados desplazados una hora.
 */
function offsetMin(instante: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const comoUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return (comoUtc - instante.getTime()) / 60000;
}

/**
 * Convierte una fecha y hora escritas en horario local de `tz` al instante
 * UTC correspondiente. Se aplica dos veces porque el desfase depende del
 * propio instante: la primera pasada da una aproximación y la segunda la
 * corrige si el cambio de hora cae en medio.
 */
export function zonedTimeUtc(day: string, hhmm: string, tz: string): string {
  const base = Date.parse(`${day}T${hhmm}:00Z`);
  let utc = base - offsetMin(new Date(base), tz) * 60000;
  utc = base - offsetMin(new Date(utc), tz) * 60000;
  return new Date(utc).toISOString();
}

// Medianoche local de `day` (YYYY-MM-DD) en la zona `tz`, como instante UTC.
export function zonedMidnightUtc(day: string, tz: string): string {
  return zonedTimeUtc(day, "00:00", tz);
}

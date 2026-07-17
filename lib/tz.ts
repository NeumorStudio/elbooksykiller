// Medianoche local de `day` (YYYY-MM-DD) en la zona `tz`, como instante UTC.
export function zonedMidnightUtc(day: string, tz: string): string {
  const utcGuess = new Date(`${day}T00:00:00Z`);
  const asLocal = new Date(utcGuess.toLocaleString("en-US", { timeZone: tz }));
  return new Date(utcGuess.getTime() + (utcGuess.getTime() - asLocal.getTime())).toISOString();
}

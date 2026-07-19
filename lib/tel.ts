/**
 * Normaliza un teléfono para el atributo `tel:`.
 *
 * El dueño escribe el número como se lee ("+34 671 27 21 11"), que es lo
 * correcto en pantalla. Pero en el href los espacios son poco fiables:
 * algunos marcadores de Android los cortan y llaman a un número
 * incompleto. Se conserva el "+" inicial y se quita todo lo demás.
 */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}

/**
 * Forma canónica E.164 de un teléfono, o null si aquello no es un teléfono.
 *
 * Espejo de normalizar_tel() en la migración 0006: si cambias uno, cambia
 * el otro. "671272111", "+34 671 27 21 11" y "671-27-21-11" son la misma
 * persona y deben producir la misma clave; el "—" de los clientes de
 * mostrador debe producir null, no un cliente fantasma.
 */
export function normalizarTel(tel: string): string | null {
  const digits = tel.replace(/\D/g, "");
  if (tel.trim().startsWith("+") && digits.length >= 9 && digits.length <= 15)
    return `+${digits}`;
  if (digits.startsWith("0034") && digits.length === 13) return `+${digits.slice(2)}`;
  if (digits.startsWith("34") && digits.length === 11) return `+${digits}`;
  if (digits.length === 9) return `+34${digits}`;
  return null;
}

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

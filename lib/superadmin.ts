import "server-only";

/**
 * Quién puede entrar en /admin/super: los emails de SUPERADMIN_EMAILS
 * (separados por comas). Sin la variable, nadie — el panel no existe.
 * ponytail: emails en env, tabla de roles cuando haya más de un operador.
 */
export function esSuperadmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

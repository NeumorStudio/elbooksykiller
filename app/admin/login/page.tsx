"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Solo entrar. El registro se quitó junto con el alta de salón: las cuentas de
 * dueño las creamos nosotros en Supabase Auth y les damos la contraseña.
 *
 * Ojo con lo que esto es y lo que no. Quitar el formulario no impide llamar a
 * `supabase.auth.signUp()` con la clave pública desde la consola del navegador
 * —igual que pasaba con el alta de salón—, y esta vez no se puede cerrar por
 * abajo: apagar «Allow new users to sign up» en Supabase es global y rompería
 * el acceso de los clientes, que se registran solos por magic link en /perfil.
 *
 * Se acepta porque una cuenta suelta no puede hacer nada: sin fila en `salons`
 * el panel no le enseña más que «tu cuenta aún no tiene salón», y la migración
 * 0023 le quitó el INSERT a `authenticated`, así que no puede fabricársela.
 * ponytail: si algún día molestan las cuentas huérfanas, un hook de Supabase
 * Auth puede rechazar los altas por contraseña sin tocar las de magic link.
 */
const ERRORS: Record<string, string> = {
  "Invalid login credentials": "Email o contraseña incorrectos.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(ERRORS[error.message] ?? "No se pudo entrar. Inténtalo de nuevo.");
    else {
      router.push("/admin");
      router.refresh();
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl font-semibold text-center text-brand">
          Salonio
        </h1>
        <p className="text-center text-muted mt-2 mb-8">Entra en tu panel</p>
        <form onSubmit={submit} className="panel p-6 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="password" className="label">Contraseña</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button disabled={loading} className="btn-primary">
            {loading ? "Un momento…" : "Entrar"}
          </button>
        </form>
        <p className="text-center text-sm text-muted mt-4 text-pretty">
          ¿Eres cliente de una peluquería y vienes a ver tus citas? Entra desde{" "}
          <a href="/perfil" className="underline underline-offset-4 hover:text-ink">
            tu perfil
          </a>
          .
        </p>
      </div>
    </main>
  );
}

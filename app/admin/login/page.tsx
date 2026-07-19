"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  "Invalid login credentials": "Email o contraseña incorrectos.",
  "User already registered": "Ese email ya tiene cuenta. Prueba a entrar.",
};

function LoginForm() {
  const router = useRouter();
  // El CTA "Empieza gratis" de la landing llega con ?signup=1: sin esto,
  // el usuario nuevo caía en "Entra en tu panel" y tenía que encontrar el
  // enlace pequeño de registro.
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(
    searchParams.get("signup") ? "signup" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = supabaseBrowser();
    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setError(ERRORS[error.message] ?? "No se pudo completar. Inténtalo de nuevo.");
    else {
      router.push("/admin");
      router.refresh();
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl font-semibold text-center text-brand">
          ElBooksyKiller
        </h1>
        <p className="text-center text-muted mt-2 mb-8">
          {mode === "login"
            ? "Entra en tu panel"
            : "Crea tu cuenta y monta tu web de reservas"}
        </p>
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
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
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
            {loading ? "Un momento…" : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
          className="block mx-auto mt-4 text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "Ya tengo cuenta"}
        </button>
      </div>
    </main>
  );
}

// useSearchParams exige un límite de Suspense en el prerender.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

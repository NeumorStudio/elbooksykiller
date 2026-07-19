"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Entrada del cliente por magic link (OTP por email). Sin contraseña: se
 * pide el email, Supabase manda el enlace, y el callback crea la sesión.
 */
export default function PerfilLogin() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviado" | "error">("idle");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/perfil`,
      },
    });
    setEstado(error ? "error" : "enviado");
  }

  if (estado === "enviado") {
    return (
      <div className="panel p-6 text-center" role="status">
        <p className="font-semibold">Revisa tu correo 📬</p>
        <p className="text-sm text-muted mt-2 text-pretty">
          Te hemos enviado un enlace a <b>{email}</b>. Ábrelo desde este mismo
          móvil para entrar — sin contraseñas.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="panel p-6 flex flex-col gap-4">
      <div>
        <label htmlFor="pf-email" className="label">Tu email</label>
        <input
          id="pf-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className="field"
        />
        <p className="text-xs text-muted mt-1.5 text-pretty">
          Usa el mismo email con el que reservaste. Te llega un enlace, sin
          contraseñas.
        </p>
      </div>
      {estado === "error" && (
        <p className="text-sm text-danger" role="alert">
          No se pudo enviar. Revisa el email e inténtalo de nuevo.
        </p>
      )}
      <button disabled={estado === "enviando"} className="btn-primary">
        {estado === "enviando" ? "Enviando…" : "Entrar con mi email"}
      </button>
    </form>
  );
}

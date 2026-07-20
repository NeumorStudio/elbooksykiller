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
        {/* El navegador interno de Instagram rompe los magic links: es el
            canal principal de entrada y el fallo no se explica solo. */}
        <p className="text-xs text-faint mt-3 text-pretty">
          Si has llegado desde Instagram, abre el enlace en Chrome o Safari:
          el navegador de la app no lo acepta.
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
        {/* Antes decía solo "usa el mismo email con el que reservaste", pero
            signInWithOtp crea cuenta si no existe: quien se equivocaba de
            email acababa con una cuenta vacía sin entender por qué. */}
        <p className="text-xs text-muted mt-1.5 text-pretty">
          Usa el <b>mismo email con el que reservaste</b> y encontrarás tus
          citas y tu tarjeta. Si es tu primera vez, te creamos la cuenta con
          ese mismo enlace. Sin contraseñas.
        </p>
      </div>
      {estado === "error" && (
        <p className="text-sm text-danger" role="alert">
          No se pudo enviar. Revisa el email e inténtalo de nuevo.
        </p>
      )}
      <button disabled={estado === "enviando"} className="btn-primary">
        {estado === "enviando" ? "Enviando…" : "Entrar o crear mi cuenta"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Entrada del cliente por magic link (OTP por email). Sin contraseña: se
 * pide el email, Supabase manda el enlace, y el callback crea la sesión.
 */
export default function PerfilLogin({
  proveedores = { google: false, apple: false },
}: {
  proveedores?: { google: boolean; apple: boolean };
}) {
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

  /**
   * Entrar con Google o Apple: un toque, sin salir a buscar el correo.
   *
   * Es bastante mejor que el magic link para el caso real —alguien en la
   * silla del salón, con el móvil en la mano— y además esquiva el fallo del
   * navegador interno de Instagram, que rompe los enlaces del correo.
   */
  async function conProveedor(provider: "google" | "apple") {
    await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/perfil` },
    });
  }

  const hayProveedores = proveedores.google || proveedores.apple;

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
      {/* Arriba del email a propósito: para quien viene con el móvil en la
          mano es un toque contra escribir su correo y salir a buscarlo. */}
      {hayProveedores && (
        <>
          <div className="flex flex-col gap-2">
            {proveedores.google && (
              <button
                type="button"
                onClick={() => conProveedor("google")}
                className="btn-quiet flex items-center justify-center gap-3"
              >
                <svg aria-hidden viewBox="0 0 18 18" className="h-[18px] w-[18px]">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
                </svg>
                Continuar con Google
              </button>
            )}
            {proveedores.apple && (
              <button
                type="button"
                onClick={() => conProveedor("apple")}
                className="btn-quiet flex items-center justify-center gap-3"
              >
                <svg aria-hidden viewBox="0 0 384 512" className="h-[18px] w-[18px] fill-current">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                </svg>
                Continuar con Apple
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />o con tu email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

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

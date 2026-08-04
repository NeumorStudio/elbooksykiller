"use client";

import { useState } from "react";
import { guardarEmailCliente } from "./actions";

/**
 * «Deja tu correo y tendrás tus citas y tus sellos siempre a mano.»
 *
 * Se ofrece solo a quien reservó sin correo. No es un registro: no hay
 * contraseña ni formulario largo, solo el email — y con él, la próxima vez
 * que entre en su perfil con el enlace mágico, su ficha entera (visitas,
 * sellos, historial) le estará esperando.
 *
 * Importante lo que NO se le pide: para ver ESTA cita no hace falta nada,
 * está en el enlace que ya tiene. Venderlo como «regístrate para ver tu
 * cita» sería fricción inventada.
 */
export default function GuardarEmail({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"listo" | "yendo" | "hecho">("listo");
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);

  if (estado === "hecho") {
    return (
      <p className="text-sm text-ok text-center text-pretty">
        ✓ Correo guardado. Entra en <b>Mi cuenta</b> con él y tendrás aquí tus
        citas y tus sellos.
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="btn-quiet text-sm"
      >
        Guardar mis citas y mis sellos
      </button>
    );
  }

  return (
    <form
      className="w-full max-w-sm flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setEstado("yendo");
        const r = await guardarEmailCliente(token, email);
        if (r.error) {
          setError(r.error);
          setEstado("listo");
          return;
        }
        setEstado("hecho");
      }}
    >
      <label htmlFor="ge-email" className="text-sm text-muted text-pretty">
        Déjanos tu correo y podrás ver tu historial y tus sellos cuando
        quieras. Para esta cita no hace falta: ya tienes su enlace.
      </label>
      <div className="flex gap-2">
        <input
          id="ge-email"
          type="email"
          required
          autoComplete="email"
          placeholder="tucorreo@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field flex-1"
        />
        <button disabled={estado === "yendo"} className="btn-quiet shrink-0">
          {estado === "yendo" ? "…" : "Guardar"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

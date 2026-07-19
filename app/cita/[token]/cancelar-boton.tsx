"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarCita } from "./actions";

export default function CancelarBoton({
  token,
  pagada,
}: {
  token: string;
  pagada: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        className="btn-danger text-sm"
        disabled={pending}
        onClick={() => {
          const aviso = pagada
            ? "¿Cancelar la cita? Se te devolverá el pago completo."
            : "¿Cancelar la cita? El hueco quedará libre para otra persona.";
          if (!window.confirm(aviso)) return;
          start(async () => {
            const r = await cancelarCita(token);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? "Cancelando…" : "Cancelar mi cita"}
      </button>
      {error && (
        <p className="text-sm text-danger mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

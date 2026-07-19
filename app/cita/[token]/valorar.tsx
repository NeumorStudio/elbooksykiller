"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { valorar } from "./actions";

/**
 * Valoración privada 1-5. Tras valorar — CUALQUIER nota — se ofrece el
 * enlace de Google: enseñárselo solo a los contentos (review gating) está
 * prohibido y puede costarle la ficha al salón.
 */
export default function Valorar({
  token,
  yaValorada,
  googleUrl,
  salonName,
}: {
  token: string;
  yaValorada: number | null;
  googleUrl: string | null;
  salonName: string;
}) {
  const [nota, setNota] = useState<number | null>(yaValorada);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (nota !== null) {
    return (
      <div className="panel p-6" id="valorar">
        <p className="font-semibold">Gracias por valorarnos {"★".repeat(nota)}</p>
        <p className="text-sm text-muted mt-1">
          Tu nota es privada: solo la ve el equipo de {salonName}.
        </p>
        {googleUrl && (
          <p className="text-sm mt-4">
            Si te apetece contarlo en público, aquí tienes nuestra ficha:{" "}
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener"
              className="underline underline-offset-4 text-brand"
            >
              reseñas en Google
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel p-6" id="valorar">
      <p className="font-semibold">¿Qué tal fue?</p>
      <p className="text-sm text-muted mt-1">
        Es un toque y es privado — nos ayuda a mejorar.
      </p>
      <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Valoración de 1 a 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={false}
            aria-label={`${n} de 5`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await valorar(token, n);
                if (r.error) setError(r.error);
                else {
                  setNota(n);
                  router.refresh();
                }
              })
            }
            className="chip h-12 w-12 text-lg"
          >
            {n}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-danger mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

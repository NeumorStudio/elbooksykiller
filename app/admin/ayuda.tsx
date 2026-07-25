"use client";

import { useEffect, useState } from "react";

/**
 * Botón «i» junto al título de cada pantalla: abre una ficha que explica
 * cómo se usa, en lenguaje llano. Pensado para quien nunca ha usado un
 * programa de gestión. Mismo patrón de modal que DetalleCita en la agenda.
 */
export default function Ayuda({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={`Cómo funciona: ${titulo}`}
        title="¿Cómo funciona esta pantalla?"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full
          border border-line font-display italic text-base text-muted
          hover:text-brand hover:border-brand
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        i
      </button>

      {abierta && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-5"
          onClick={() => setAbierta(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Cómo funciona: ${titulo}`}
        >
          <div
            className="tarjeta w-full max-w-md max-h-[85vh] overflow-y-auto rounded-b-none sm:rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <p className="rotulo after:hidden">Cómo funciona</p>
                <h2 className="font-display text-2xl truncate">{titulo}</h2>
              </div>
              <button
                onClick={() => setAbierta(false)}
                aria-label="Cerrar"
                className="btn-quiet h-9 w-9 shrink-0 px-0 text-lg"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3 text-sm text-pretty leading-relaxed [&_b]:font-semibold">
              {children}
            </div>
            <button
              onClick={() => setAbierta(false)}
              className="btn-primary mt-5 w-full"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}

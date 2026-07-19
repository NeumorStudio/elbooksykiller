"use client";

import { useActionState, useEffect, useRef } from "react";

type ActionResult<T> = { error?: string; ok?: T } | void;

// Formulario que muestra el error de la server action junto al propio form,
// en vez de tirar la página entera.
//
// `onSuccess` es opcional: las acciones que no devuelven `ok` (la mayoría)
// no lo necesitan y no cambian de comportamiento.
export default function ActionForm<T = unknown>({
  action,
  className,
  children,
  onSuccess,
}: {
  action: (formData: FormData) => Promise<ActionResult<T>>;
  className?: string;
  children: React.ReactNode;
  onSuccess?: (ok: T) => void;
}) {
  const [state, formAction] = useActionState(
    async (_prev: { error?: string; ok?: T } | undefined, formData: FormData) =>
      (await action(formData)) ?? undefined,
    undefined
  );

  // En un ref para que volver a renderizar el padre con otra función no
  // vuelva a disparar el efecto: cada envío tiene que avisar una sola vez.
  const alAcertar = useRef(onSuccess);
  alAcertar.current = onSuccess;

  // El estado que devuelve useActionState es un objeto nuevo por envío, así
  // que dos altas seguidas idénticas también avisan las dos veces.
  useEffect(() => {
    if (state?.ok !== undefined) alAcertar.current?.(state.ok);
  }, [state]);

  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p className="text-sm text-danger basis-full" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

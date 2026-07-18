"use client";

import { useActionState } from "react";

type ActionResult = { error?: string } | void;

// Formulario que muestra el error de la server action junto al propio form,
// en vez de tirar la página entera.
export default function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(
    async (_prev: { error?: string } | undefined, formData: FormData) =>
      (await action(formData)) ?? undefined,
    undefined
  );
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

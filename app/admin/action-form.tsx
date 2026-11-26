"use client";

import { useActionState, useEffect, useLayoutEffect, useRef } from "react";

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
  const formRef = useRef<HTMLFormElement>(null);
  // Lo último que se envió, para devolverlo a los campos si sale mal.
  const enviado = useRef<FormData | null>(null);

  const [state, formAction] = useActionState(
    async (_prev: { error?: string; ok?: T } | undefined, formData: FormData) => {
      enviado.current = formData;
      return (await action(formData)) ?? undefined;
    },
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

  // React 19 vacía el formulario al acabar cada envío, también cuando la
  // acción devuelve un error. Al guardar está bien —el campo limpio evita
  // apuntar dos veces lo mismo—, pero tras un «ese hueco ya está cogido» el
  // dueño tenía que volver a escribir nombre y teléfono con el cliente
  // delante. Si hay error, se devuelve lo enviado a cada campo. Va en
  // `useLayoutEffect` porque el vaciado ocurre en el mismo commit, justo
  // antes: así no llega a verse el formulario en blanco.
  useLayoutEffect(() => {
    const form = formRef.current;
    const datos = enviado.current;
    if (!state?.error || !form || !datos) return;
    devolverCampos(form, datos);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p className="text-sm text-danger basis-full" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Vuelve a poner en el formulario lo que se envió. Los ocultos los lleva
 * React y un archivo no se puede reponer por seguridad del navegador, así que
 * esos se dejan como estén.
 */
function devolverCampos(form: HTMLFormElement, datos: FormData) {
  // Campos con el mismo nombre (dos `hora`, por ejemplo) van por orden.
  const vistos = new Map<string, number>();
  for (const el of Array.from(form.elements)) {
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLSelectElement) &&
      !(el instanceof HTMLTextAreaElement)
    )
      continue;
    if (!el.name || el.disabled) continue;
    const valores = datos.getAll(el.name).filter((v): v is string => typeof v === "string");

    if (el instanceof HTMLInputElement) {
      if (el.type === "hidden" || el.type === "file") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        el.checked = valores.includes(el.value);
        continue;
      }
    }
    if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.options)) o.selected = valores.includes(o.value);
      continue;
    }

    const i = vistos.get(el.name) ?? 0;
    vistos.set(el.name, i + 1);
    if (valores[i] !== undefined) el.value = valores[i];
  }
}

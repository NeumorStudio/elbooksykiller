"use client";

import { useFormStatus } from "react-dom";

// Botón de formulario con estado de envío: se deshabilita mientras la
// server action corre (evita dobles altas) y avisa visualmente.
export default function SubmitButton({
  children,
  pendingText = "Guardando…",
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

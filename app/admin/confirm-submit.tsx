"use client";

// Botón de submit para acciones destructivas: pide confirmación nativa
// mostrando la consecuencia antes de enviar el formulario.
export default function ConfirmSubmit({
  message,
  className = "btn-danger text-sm",
  children,
  ...rest
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

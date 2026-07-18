"use client";

// Red de seguridad del panel: un fallo inesperado no deja pantalla rota.
export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="day min-h-screen bg-bg text-ink flex items-center justify-center p-6">
      <div className="panel p-8 text-center max-w-md">
        <p className="font-display text-2xl font-semibold">Algo ha fallado</p>
        <p className="text-muted mt-2 text-pretty">
          No se ha guardado el último cambio. Vuelve a intentarlo; si sigue
          pasando, recarga la página.
        </p>
        <button onClick={reset} className="btn-primary mt-6">
          Reintentar
        </button>
      </div>
    </main>
  );
}

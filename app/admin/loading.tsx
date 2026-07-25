/**
 * Esqueleto mientras carga cualquier sección del panel.
 *
 * Es el arreglo de raíz del "no sé si le he dado": con esto la navegación
 * cambia de pantalla en el acto —el enlace pulsado se marca como activo y
 * aparece este armazón— en vez de dejar la sección anterior congelada
 * mientras el servidor responde. En una tablet vieja es la diferencia entre
 * parecer roto y parecer rápido.
 *
 * Geometría deliberadamente neutra: título, subtítulo y tres bloques. Sirve
 * para las nueve secciones sin prometer un contenido concreto.
 */
export default function Cargando() {
  return (
    <div className="flex flex-col gap-8 max-w-2xl mx-auto" aria-hidden>
      <div>
        <span className="block h-9 w-56 rounded-lg bg-surface-2 animate-pulse" />
        <span className="mt-3 block h-4 w-72 max-w-full rounded bg-surface-2 animate-pulse" />
      </div>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-28 rounded-2xl bg-surface-2 animate-pulse"
          style={{ opacity: 1 - i * 0.25 }}
        />
      ))}
      <span className="sr-only" role="status">Cargando…</span>
    </div>
  );
}

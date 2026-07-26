"use client";

/**
 * El logo, que devuelve al inicio sin recargar la página.
 *
 * La primera versión era un `<a>` normal a `/[slug]`, copiando el «Inicio»
 * de la barra inferior: recarga completa, que reinicia el widget y sale del
 * modo reserva de la forma más tonta posible. Funcionaba, pero se notaba —
 * viaje al servidor, la página entera otra vez, las fotos otra vez.
 *
 * No hace falta nada de eso. Salir del modo reserva es quitar un atributo de
 * <html> y limpiar el fragmento de la URL: las dos cosas son instantáneas.
 * Y conservar lo que el cliente llevaba elegido en el widget es mejor que
 * borrárselo — si sube a mirar el horario y vuelve a bajar, su selección
 * sigue ahí en vez de tener que empezar de cero.
 *
 * Se mantiene el `href` real: así el clic con Ctrl o rueda sigue abriendo en
 * otra pestaña, y sin JS el enlace navega igual. Solo se intercepta el clic
 * normal.
 */
export default function LogoInicio({
  href,
  etiqueta,
  className,
  children,
}: {
  href: string;
  etiqueta: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={etiqueta}
      className={className}
      onClick={(e) => {
        // Abrir en pestaña nueva, o con un botón que no sea el principal:
        // que el navegador haga lo suyo.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();

        document.documentElement.removeAttribute("data-reserva");
        // Fuera el #reservar, o la regla de refuerzo con :target seguiría
        // ocultando el escaparate aunque el atributo ya no esté.
        if (location.hash) {
          history.replaceState(null, "", location.pathname + location.search);
        }
        // Salto inmediato, no suave: al reaparecer el escaparate la página
        // crece de golpe, y una animación de scroll sobre un alto que está
        // cambiando se ve como un tirón. Lo instantáneo aquí es lo fluido.
        window.scrollTo({ top: 0, behavior: "auto" });
      }}
    >
      {children}
    </a>
  );
}

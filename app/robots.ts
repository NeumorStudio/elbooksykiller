import type { MetadataRoute } from "next";

/**
 * Qué puede rastrear un buscador.
 *
 * Las páginas de cada salón SÍ interesan: que la barbería aparezca al
 * buscarla por su nombre es media razón para tener web propia en vez de
 * estar en un marketplace. Lo que se cierra es todo lo que cuelga de un
 * token o de una sesión —la ficha de una cita, la baja de la newsletter,
 * el panel del dueño—. Esas rutas ya llevan `noindex` en su metadata; esto
 * es el segundo cerrojo, para que ni siquiera lleguen a pedirse.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/auth", "/perfil", "/cita", "/baja"],
    },
  };
}

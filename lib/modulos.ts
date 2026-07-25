import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Módulos apagables por salón — la base de los planes de pago.
 *
 * Cada clave es una sección del panel del dueño; `salons.modules` guarda
 * {"clave": false} para las apagadas y NULL significa todo activo. Agenda,
 * Servicios, Equipo y Mi web son el núcleo del producto: no se apagan.
 * La fidelización vive dentro de Clientes y las reseñas dentro de Mi web,
 * así que se apagan con su sección.
 */
export const MODULOS = {
  clientes: { nombre: "Clientes", href: "/admin/clientes" },
  productos: { nombre: "Productos", href: "/admin/productos" },
  newsletter: { nombre: "Newsletter", href: "/admin/newsletter" },
  cobros: { nombre: "Cobros", href: "/admin/payments" },
  estadisticas: { nombre: "Estadísticas", href: "/admin/stats" },
} as const;
export type Modulo = keyof typeof MODULOS;

export type EstadoSalon = {
  blocked: boolean;
  modules: Partial<Record<Modulo, boolean>> | null;
};

const TODO_ACTIVO: EstadoSalon = { blocked: false, modules: null };

/**
 * Bloqueo y módulos de un salón. Antes de aplicar la migración 0013 las
 * columnas no existen y la consulta falla: se devuelve "todo activo", que
 * es exactamente el comportamiento de hoy — mismo patrón que features().
 * cache() deduplica dentro de la misma petición (layout + página).
 */
export const estadoSalon = cache(async (salonId: string): Promise<EstadoSalon> => {
  try {
    const { data, error } = await supabaseAdmin()
      .from("salons")
      .select("blocked, modules")
      .eq("id", salonId)
      .maybeSingle();
    if (error || !data) return TODO_ACTIVO;
    const fila = data as unknown as {
      blocked: boolean | null;
      modules: EstadoSalon["modules"];
    };
    return { blocked: !!fila.blocked, modules: fila.modules ?? null };
  } catch {
    return TODO_ACTIVO;
  }
});

/**
 * Con qué arranca un salón al que nadie ha tocado los módulos.
 *
 * Todo encendido menos **Cobros**, que empieza apagado a propósito: Stripe
 * Connect sigue en beta —hay cuentas a medio verificar en producción— y un
 * salón que enciende pagos sin querer se mete en un lío de dinero real que
 * no sabe deshacer. Que lo pida quien lo quiera.
 */
export const POR_DEFECTO: Record<Modulo, boolean> = {
  clientes: true,
  productos: true,
  newsletter: true,
  cobros: false,
  estadisticas: true,
};

// `?? `, no `!== false`: un módulo sin anotar cae a su defecto, y el defecto
// ya no es "encendido" para todos.
export const moduloActivo = (estado: EstadoSalon, m: Modulo) =>
  estado.modules?.[m] ?? POR_DEFECTO[m];

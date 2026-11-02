import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";

/**
 * El puesto de trabajador de quien está dentro: qué profesional es y de qué
 * salón. `null` si no es trabajador (o si la 0033 aún no está aplicada).
 *
 * Sale de la RPC `mi_puesto`, que solo devuelve la fila de su propia cuenta:
 * el trabajador no tiene acceso directo a ninguna tabla del salón.
 * `cache()` porque lo piden el layout, su metadata y la página en la misma
 * petición.
 */
export type Puesto = {
  employee_id: string;
  employee_name: string;
  active: boolean;
  salon_id: string;
  salon_name: string;
  salon_slug: string;
  timezone: string;
  blocked: boolean;
  /**
   * Los dos interruptores del dueño (0034). `undefined` mientras esa
   * migración no esté aplicada, que se lee igual que apagado.
   */
  ver_agenda_equipo?: boolean;
  apuntar_citas?: boolean;
};

export const miPuesto = cache(async (): Promise<Puesto | null> => {
  const f = await features();
  if (!f.trabajadores) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("mi_puesto");
  if (error) {
    console.error("miPuesto:", error.message);
    return null;
  }
  return ((data as Puesto[] | null) ?? [])[0] ?? null;
});

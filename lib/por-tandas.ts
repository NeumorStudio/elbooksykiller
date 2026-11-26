/**
 * Todas las filas de una consulta, pidiéndolas por tandas.
 *
 * PostgREST corta cada respuesta en `max-rows` (1000 en Supabase) y no
 * avisa: devuelve las primeras y ya. Con un `.limit()` propio pasa lo mismo
 * pero antes. En el salón piloto la agenda pedía como mucho 400 citas desde
 * el día 1 del mes, en orden de fecha; hacia el día 20 ya había 400, y las
 * de hoy en adelante no llegaban a la pantalla. El hueco salía libre, el
 * dueño intentaba apuntar ahí y la base lo rechazaba por solape.
 *
 * `pedir` recibe el tramo `[desde, hasta]` (ambos incluidos, como
 * `.range()`) y tiene que llevar un orden estable —con `id` de desempate—
 * para que una fila no salga en dos tandas ni en ninguna. Se para cuando una
 * tanda vuelve incompleta, o en `maxTandas`, que es solo un freno por si
 * algo se tuerce: con 20 tandas de 1000 caben años de agenda.
 */
export const TANDA = 1000;

type Respuesta = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

export async function porTandas(
  pedir: (desde: number, hasta: number) => Respuesta,
  maxTandas = 20
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const filas: unknown[] = [];
  for (let i = 0; i < maxTandas; i++) {
    const { data, error } = await pedir(i * TANDA, (i + 1) * TANDA - 1);
    if (error) return { data: filas, error };
    const tanda = data ?? [];
    filas.push(...tanda);
    if (tanda.length < TANDA) break;
  }
  return { data: filas, error: null };
}

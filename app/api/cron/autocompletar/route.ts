import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Autocompleta las citas que ya pasaron: `confirmed` con el fin hace más de
 * 12 horas pasa a `completed`.
 *
 * Es la bisagra de la fidelización: el sello se gana al completar, y en un
 * día de faena el dueño no marca nada. Sin esto, el cliente cuenta 6 cortes,
 * la app dice 3, y la discusión es en el mostrador — peor que no tener
 * tarjeta.
 *
 * Pero el automatismo no debe ganarle la mano a la persona: marcar «no vino»
 * es lo que sostiene las faltas y las estadísticas, y con tres horas de
 * margen la cita se cerraba sola a media tarde. Doce horas cierran el día
 * por la noche, que es cuando se cierra un día de verdad.
 *
 * Funciona sobre el esquema base: 'completed' existe desde el día uno. Con
 * la migración 0007 aplicada, el mismo UPDATE dispara el sello — sin ella,
 * solo arregla el KPI de "no presentados" que siempre marcaba 0.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin secreto configurado se cierra: fallar en abierto dejaba el cron
  // invocable por cualquiera (envíos masivos, citas marcadas solas).
  if (!secret) return new NextResponse("cron sin configurar", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("no autorizado", { status: 401 });
  }

  // Ventana acotada a 7 días: lo más viejo es historia ambigua, no algo que
  // autocompletar — y evita que la primera ejecución complete en masa cientos
  // de reservas antiguas regalando un sello por cada una si el programa de
  // fidelidad ya está activo.
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .update({ status: "completed" })
    .eq("status", "confirmed")
    /**
     * Doce horas, no tres.
     *
     * Con tres, una cita de la mañana quedaba cerrada a media tarde — y como
     * la agenda solo enseñaba las confirmadas, desaparecía de la pantalla
     * llevándose los botones de «vino / no vino». La ventana real para
     * marcar una falta era una tarde, y por eso el contador de no
     * presentados marcaba siempre cero.
     *
     * Con doce, lo del día se cierra por la noche y lo de la tarde a la
     * mañana siguiente: da margen a cerrar el día con calma. La agenda
     * además ya no las esconde, así que corregir sigue siendo posible
     * después; esto solo decide cuándo se da por buena una cita que nadie
     * ha tocado.
     */
    .lt("ends_at", new Date(Date.now() - 12 * 3600_000).toISOString())
    .gt("ends_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .select("id");

  if (error) {
    console.error("[autocompletar] fallo:", error.message);
    return NextResponse.json({ error: "fallo" }, { status: 500 });
  }

  return NextResponse.json({ completadas: data?.length ?? 0 });
}

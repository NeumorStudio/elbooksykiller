import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Autocompleta las citas que ya pasaron: `confirmed` con el fin hace más de
 * 3 horas pasa a `completed`.
 *
 * Es la bisagra de la fidelización: el sello se gana al completar, y en un
 * día de faena el dueño no marca nada. Sin esto, el cliente cuenta 6 cortes,
 * la app dice 3, y la discusión es en el mostrador — peor que no tener
 * tarjeta. Con esto, el botón "no vino" pasa a ser una corrección con
 * ventana (el trigger de la migración 0007 retira el sello si aún no se
 * canjeó), no un requisito.
 *
 * Funciona sobre el esquema base: 'completed' existe desde el día uno. Con
 * la migración 0007 aplicada, el mismo UPDATE dispara el sello — sin ella,
 * solo arregla el KPI de "no presentados" que siempre marcaba 0.
 *
 * Las 3 horas de margen dejan hueco para marcar "no vino" a mano antes de
 * que el autocompletado dé el sello por bueno.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
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
    .lt("ends_at", new Date(Date.now() - 3 * 3600_000).toISOString())
    .gt("ends_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .select("id");

  if (error) {
    console.error("[autocompletar] fallo:", error.message);
    return NextResponse.json({ error: "fallo" }, { status: 500 });
  }

  return NextResponse.json({ completadas: data?.length ?? 0 });
}

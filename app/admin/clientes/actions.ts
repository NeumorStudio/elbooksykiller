"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import { sesionAdmin } from "@/lib/sesion-admin";

// Comprueba sesión y que el salón no esté bloqueado por el superadmin.
const db = sesionAdmin;

/** Configura el programa de sellos. Upsert: la fila es el salón. */
export async function guardarPrograma(formData: FormData) {
  const { fidelizacion } = await features();
  if (!fidelizacion) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const visitas = Number(formData.get("required_visits") ?? 6);
  const premio = String(formData.get("reward") ?? "").trim();
  if (!Number.isInteger(visitas) || visitas < 2 || visitas > 50)
    return { error: "Las visitas deben estar entre 2 y 50." };
  if (premio.length < 3) return { error: "Describe el premio." };

  const { error } = await supabase.from("loyalty_programs").upsert({
    salon_id: salon.id,
    active: formData.get("active") === "on",
    required_visits: visitas,
    reward: premio,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath("/admin/clientes");
}

/** Configura la escalera de penalizaciones por faltas. Upsert como el programa de sellos. */
export async function guardarPenalizaciones(formData: FormData) {
  const { penalizaciones } = await features();
  if (!penalizaciones) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const blockAfter = Number(formData.get("block_after") ?? 2);
  const blockDays = Number(formData.get("block_days") ?? 15);
  const banAfter = Number(formData.get("ban_after") ?? 3);
  if (!Number.isInteger(blockAfter) || blockAfter < 1 || blockAfter > 10)
    return { error: "Las faltas para el bloqueo deben estar entre 1 y 10." };
  if (!Number.isInteger(blockDays) || blockDays < 1 || blockDays > 365)
    return { error: "Los días de bloqueo deben estar entre 1 y 365." };
  if (!Number.isInteger(banAfter) || banAfter <= blockAfter || banAfter > 20)
    return { error: "El veto debe llegar después del bloqueo (y como mucho a las 20 faltas)." };

  const { error } = await supabase.from("penalty_programs").upsert({
    salon_id: salon.id,
    active: formData.get("active") === "on",
    block_after: blockAfter,
    block_days: blockDays,
    ban_after: banAfter,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath("/admin/clientes");
}

/**
 * Añade un escalón a la tarjeta.
 *
 * `stamps` es **la visita en la que toca**, no un precio: el premio se
 * entrega al llegar a esa visita y el contador no se reinicia. Así el
 * segundo premio es para quien sigue viniendo después del primero —«el
 * corte gratis en la 9, el gel en la 15»— y no una alternativa barata que
 * se lleva el que acaba de empezar.
 */
export async function addPremio(formData: FormData) {
  const { premios } = await features();
  if (!premios) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const nombre = String(formData.get("name") ?? "").trim();
  const visita = Number(formData.get("stamps") ?? 0);
  if (nombre.length < 2) return { error: "Pon el nombre del premio." };
  if (!Number.isInteger(visita) || visita < 1 || visita > 100)
    return { error: "La visita tiene que ser un número entre 1 y 100." };

  const { error } = await supabase.from("loyalty_rewards").insert({
    salon_id: salon.id,
    name: nombre,
    stamps: visita,
    // En orden de escalera: es como lo va a leer el cliente.
    sort_order: visita,
  });
  if (error) return { error: "No se pudo añadir. Inténtalo de nuevo." };
  revalidatePath("/admin/clientes");
}

/**
 * Retira un premio.
 *
 * Se borra de verdad, no se desactiva: un premio retirado no tiene historia
 * que conservar — lo que se llevó cada cliente está copiado en su canje, con
 * el nombre que tenía ese día.
 */
export async function deletePremio(formData: FormData) {
  const { premios } = await features();
  if (!premios) return { error: "Todavía no está activada." };

  const { supabase } = await db();
  // RLS acota al dueño: un id ajeno borra cero filas.
  const { error } = await supabase
    .from("loyalty_rewards")
    .delete()
    .eq("id", String(formData.get("id") ?? ""));
  if (error) return { error: "No se pudo quitar. Inténtalo de nuevo." };
  revalidatePath("/admin/clientes");
}

/**
 * Perdón total: faltas a cero y castigos fuera. Para cuando la excusa era
 * real — RLS (owner_all_customers) limita el alcance a los clientes propios.
 */
export async function perdonarCliente(formData: FormData) {
  const { penalizaciones, cancelaciones } = await features();
  if (!penalizaciones) return { error: "Todavía no está activada." };

  const { supabase } = await db();
  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return { error: "Cliente inválido." };

  // Perdón de verdad: si se le limpian las faltas y se le deja el contador
  // de cancelaciones a última hora, el cliente sigue marcado en la ficha
  // para siempre y el botón no ha perdonado nada.
  const { error } = await supabase
    .from("customers")
    .update({
      no_show_strikes: 0,
      blocked_until: null,
      banned: false,
      ...(cancelaciones ? { late_cancellations: 0 } : {}),
    })
    .eq("id", customerId);
  if (error) return { error: "No se pudo perdonar. Inténtalo de nuevo." };
  revalidatePath("/admin/clientes");
}

/**
 * Canje del premio: va por la RPC canjear_premio con la SESIÓN del dueño —
 * la función comprueba auth.uid() y hace las tres escrituras en una
 * transacción (FIFO sobre los sellos más antiguos).
 */
export async function canjearPremio(formData: FormData) {
  const { fidelizacion, premios } = await features();
  if (!fidelizacion) return { error: "Todavía no está activada." };

  const { supabase } = await db();
  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return { error: "Cliente inválido." };
  const rewardId = String(formData.get("reward_id") ?? "");

  // Con la escalera se entrega el premio ELEGIDO y el contador de visitas no
  // baja; sin ella (migración 0031 aún sin aplicar) sigue valiendo la vieja,
  // que consumía sellos.
  const { error } =
    premios && rewardId
      ? await supabase.rpc("entregar_premio", {
          p_customer: customerId,
          p_reward: rewardId,
        })
      : await supabase.rpc("canjear_premio", { p_customer: customerId });
  if (error) {
    const msg = error.message.includes("not_enough_stamps")
      ? "Todavía no ha llegado a esa visita."
      : error.message.includes("already_redeemed")
        ? "Ese premio ya se lo llevó."
        : error.message.includes("program_inactive")
          ? "La tarjeta está desactivada."
          : error.message.includes("reward_not_found")
            ? "Ese premio ya no está disponible."
            : "No se pudo entregar. Inténtalo de nuevo.";
    return { error: msg };
  }
  revalidatePath("/admin/clientes");
}

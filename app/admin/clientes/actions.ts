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
  const { fidelizacion } = await features();
  if (!fidelizacion) return { error: "Todavía no está activada." };

  const { supabase } = await db();
  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return { error: "Cliente inválido." };

  const { error } = await supabase.rpc("canjear_premio", { p_customer: customerId });
  if (error) {
    const msg = error.message.includes("not_enough_stamps")
      ? "Aún no tiene sellos suficientes."
      : error.message.includes("program_inactive")
        ? "El programa está desactivado."
        : "No se pudo canjear. Inténtalo de nuevo.";
    return { error: msg };
  }
  revalidatePath("/admin/clientes");
}

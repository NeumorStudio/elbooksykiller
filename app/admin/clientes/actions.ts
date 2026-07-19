"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { features } from "@/lib/features";

async function db() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  return { supabase, user };
}

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

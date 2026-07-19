"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";

/** La baja se autentica por el token del enlace, no por sesión. */
export async function darseDeBaja(token: string): Promise<{ error?: string }> {
  const { clientes } = await features();
  if (!clientes) return { error: "No disponible." };

  const { error } = await supabaseAdmin()
    .from("customers")
    .update({ marketing_opt_in: false })
    .eq("baja_token", token);
  if (error) return { error: "No se pudo completar la baja. Inténtalo de nuevo." };

  revalidatePath(`/baja/${token}`);
  return {};
}

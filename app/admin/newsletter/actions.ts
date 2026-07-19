"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { features } from "@/lib/features";
import { estadosPorCliente, type Estado } from "../rachas";

async function db() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  return { supabase, user };
}

/**
 * Crea la campaña y encola los envíos; el cron los despacha por tandas.
 *
 * Los destinatarios son SIEMPRE marketing_opt_in = true — iniciar sesión o
 * reservar no es consentir publicidad (art. 21 LSSI-CE). Todo corre con la
 * sesión del dueño: RLS garantiza que solo toca su salón.
 */
export async function enviarNewsletter(formData: FormData) {
  const { newsletter } = await features();
  if (!newsletter) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const segment = String(formData.get("segment") ?? "todos");

  if (subject.length < 3) return { error: "Pon un asunto." };
  if (body.length < 20) return { error: "El mensaje es demasiado corto." };
  if (!["todos", "racha", "enfriandose", "nuevos"].includes(segment))
    return { error: "Segmento inválido." };

  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  // La audiencia legal: consentidos y con email.
  const { data: consentidos } = await supabase
    .from("customers")
    .select("id, email")
    .eq("salon_id", salon.id)
    .eq("marketing_opt_in", true)
    .not("email", "is", null);

  let audiencia = (consentidos ?? []) as { id: string; email: string }[];

  // El segmento filtra DENTRO de los consentidos, nunca lo amplía.
  if (segment !== "todos" && audiencia.length) {
    const { data: visitas } = await supabase
      .from("bookings")
      .select("customer_id, starts_at")
      .eq("salon_id", salon.id)
      .eq("status", "completed")
      .not("customer_id", "is", null);
    const estados = estadosPorCliente(
      (visitas ?? []) as { customer_id: string; starts_at: string }[]
    );
    audiencia = audiencia.filter(
      (c) => estados.get(c.id)?.estado === (segment as Estado)
    );
  }

  if (!audiencia.length)
    return {
      error:
        segment === "todos"
          ? "Nadie ha aceptado recibir novedades todavía. La casilla aparece al reservar."
          : "No hay clientes en ese segmento con consentimiento.",
    };

  const { data: campana, error } = await supabase
    .from("newsletter_campaigns")
    .insert({
      salon_id: salon.id,
      subject,
      body,
      segment,
      status: "sending",
      created_by: user.id,
      recipients_count: audiencia.length,
    })
    .select("id")
    .single();
  if (error || !campana) return { error: "No se pudo crear la campaña." };

  const { error: cola } = await supabase.from("newsletter_sends").insert(
    audiencia.map((c) => ({
      campaign_id: campana.id,
      customer_id: c.id,
      email: c.email,
    }))
  );
  if (cola) {
    // Sin cola no hay envío: la campaña no debe quedar "enviando" para siempre.
    await supabase
      .from("newsletter_campaigns")
      .update({ status: "failed" })
      .eq("id", campana.id);
    return { error: "No se pudo encolar el envío. Inténtalo de nuevo." };
  }

  revalidatePath("/admin/newsletter");
}

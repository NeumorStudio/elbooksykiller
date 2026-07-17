"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendEmail, cancellationHtml } from "@/lib/email";

async function db() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  return { supabase, user };
}

export async function createSalon(formData: FormData) {
  const { supabase, user } = await db();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const { error } = await supabase.from("salons").insert({
    owner_id: user.id,
    name,
    slug,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function addService(formData: FormData) {
  const { supabase } = await db();
  const { error } = await supabase.from("services").insert({
    salon_id: String(formData.get("salon_id")),
    name: String(formData.get("name") ?? "").trim(),
    price_cents: Math.round(Number(formData.get("price") ?? 0) * 100),
    duration_min: Number(formData.get("duration") ?? 30),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/services");
}

export async function deleteService(formData: FormData) {
  const { supabase } = await db();
  // Borrado suave: puede tener reservas históricas (FK restrict)
  await supabase
    .from("services")
    .update({ active: false })
    .eq("id", String(formData.get("id")));
  revalidatePath("/admin/services");
}

export async function addEmployee(formData: FormData) {
  const { supabase } = await db();
  const { error } = await supabase.from("employees").insert({
    salon_id: String(formData.get("salon_id")),
    name: String(formData.get("name") ?? "").trim(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/employees");
}

export async function deactivateEmployee(formData: FormData) {
  const { supabase } = await db();
  await supabase
    .from("employees")
    .update({ active: false })
    .eq("id", String(formData.get("id")));
  revalidatePath("/admin/employees");
}

import { zonedMidnightUtc } from "@/lib/tz";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export async function addTimeOff(formData: FormData) {
  const { supabase, user } = await db();
  const from = String(formData.get("from"));
  const to = String(formData.get("to") || from); // un solo día si no hay "hasta"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return;

  const { data: salon } = await supabase
    .from("salons")
    .select("timezone")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  const tz = salon?.timezone ?? "Europe/Madrid";

  const end = new Date(to);
  end.setDate(end.getDate() + 1); // "hasta" inclusive

  const { error } = await supabase.from("time_off").insert({
    employee_id: String(formData.get("employee_id")),
    starts_at: zonedMidnightUtc(from, tz),
    ends_at: zonedMidnightUtc(end.toISOString().slice(0, 10), tz),
    reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/employees");
}

export async function deleteTimeOff(formData: FormData) {
  const { supabase } = await db();
  await supabase.from("time_off").delete().eq("id", String(formData.get("id")));
  revalidatePath("/admin/employees");
}

export async function addHours(formData: FormData) {
  const { supabase } = await db();
  const { error } = await supabase.from("working_hours").insert({
    employee_id: String(formData.get("employee_id")),
    weekday: Number(formData.get("weekday")),
    start_min: toMin(String(formData.get("start"))),
    end_min: toMin(String(formData.get("end"))),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/employees");
}

export async function deleteHours(formData: FormData) {
  const { supabase } = await db();
  await supabase.from("working_hours").delete().eq("id", String(formData.get("id")));
  revalidatePath("/admin/employees");
}

export async function cancelBooking(formData: FormData) {
  const { supabase } = await db();
  const id = String(formData.get("id"));

  // Leer antes de cancelar (RLS: solo el dueño llega aquí con datos)
  const { data: b } = await supabase
    .from("bookings")
    .select("customer_name, customer_email, starts_at, services(name), salons(name, phone, timezone)")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (!error && b?.customer_email) {
    const salon = b.salons as unknown as { name: string; phone: string | null; timezone: string };
    await sendEmail({
      to: b.customer_email,
      subject: `Tu cita en ${salon.name} se ha cancelado`,
      html: cancellationHtml({
        salonName: salon.name,
        salonPhone: salon.phone,
        serviceName: (b.services as unknown as { name: string }).name,
        employeeName: "",
        customerName: b.customer_name,
        when: new Date(b.starts_at).toLocaleString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: salon.timezone,
        }),
      }),
      idempotencyKey: `booking-cancel/${id}`,
    });
  }
  revalidatePath("/admin");
}

export async function connectStripe() {
  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, name, stripe_account_id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) redirect("/admin");

  const { headers } = await import("next/headers");
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const { stripe } = await import("@/lib/stripe");
  let accountId = salon.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "ES",
      email: user.email ?? undefined,
      business_profile: { name: salon.name },
    });
    accountId = account.id;
    await supabase.from("salons").update({ stripe_account_id: accountId }).eq("id", salon.id);
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${base}/admin/payments`,
    return_url: `${base}/admin/payments`,
  });
  redirect(link.url);
}

export async function updateServicePayment(formData: FormData) {
  const { supabase } = await db();
  const type = String(formData.get("payment_type"));
  if (!["none", "deposit", "full"].includes(type)) return;
  const deposit = Math.round(Number(formData.get("deposit") ?? 0) * 100);
  if (type === "deposit" && deposit <= 0) return;
  await supabase
    .from("services")
    .update({
      payment_type: type,
      deposit_cents: type === "deposit" ? deposit : null,
    })
    .eq("id", String(formData.get("id")));
  revalidatePath("/admin/services");
}

const DOMAIN_RE = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/;

export async function setCustomDomain(formData: FormData) {
  const { supabase, user } = await db();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(domain) || domain.endsWith(".vercel.app")) {
    throw new Error("invalid_domain");
  }

  const { data: salon } = await supabase
    .from("salons")
    .select("id, custom_domain")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) redirect("/admin");

  const { addDomainToProject, removeDomainFromProject } = await import("@/lib/vercel");
  await addDomainToProject(domain);

  const { error } = await supabase
    .from("salons")
    .update({ custom_domain: domain })
    .eq("id", salon.id);
  if (error) {
    await removeDomainFromProject(domain);
    throw new Error(error.message); // p. ej. dominio ya usado por otro salón
  }
  if (salon.custom_domain && salon.custom_domain !== domain) {
    await removeDomainFromProject(salon.custom_domain);
  }
  revalidatePath("/admin/website");
}

export async function removeCustomDomain() {
  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, custom_domain")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon?.custom_domain) return;

  const { removeDomainFromProject } = await import("@/lib/vercel");
  await removeDomainFromProject(salon.custom_domain);
  await supabase.from("salons").update({ custom_domain: null }).eq("id", salon.id);
  revalidatePath("/admin/website");
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

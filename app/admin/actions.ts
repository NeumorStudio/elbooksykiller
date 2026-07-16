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

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

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

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

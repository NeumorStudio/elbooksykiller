"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sesionAdmin } from "@/lib/sesion-admin";
import { features } from "@/lib/features";
import { sendEmail, accesoTrabajadorHtml } from "@/lib/email";
import { baseUrl } from "@/lib/urls";

/*
 * Dar, reenviar y quitar el acceso de un profesional a su agenda, y
 * cambiarle el nombre.
 *
 * Todas empiezan igual: la sesión del DUEÑO comprueba que la ficha es de su
 * salón. Solo después se usa service role, que hace falta para dos cosas que
 * la sesión del dueño no puede ni debe hacer: crear la cuenta en Supabase
 * Auth y escribir en `employee_access` (la 0033 no deja escribir ahí a
 * nadie con la clave pública, para que nadie se fabrique un vínculo).
 */

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fichaPropia(employeeId: string) {
  const { supabase, user } = await sesionAdmin();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, name, slug, phone")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return null;
  // `employees` es de lectura pública, así que el filtro por salón es lo que
  // impide tocar la ficha de otra peluquería con un id cambiado a mano.
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, active")
    .eq("id", employeeId)
    .eq("salon_id", salon.id)
    .maybeSingle();
  if (!emp) return null;
  return { supabase, user, salon, emp };
}

/**
 * Dónde vive el panel que va en el enlace del correo. En el preview de dev
 * tiene que ser ESE preview: `baseUrl()` apunta a producción también ahí, y
 * un token de la base de dev canjeado contra producción no vale.
 */
function urlPanel(): string {
  if (process.env.VERCEL_ENV === "preview") {
    const u = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
    if (u) return `https://${u}`;
  }
  return baseUrl();
}

async function mandarEnlace(d: {
  email: string;
  nombre: string;
  salon: { name: string; slug: string; phone: string | null };
}): Promise<{ ok: true } | { error: string }> {
  const admin = supabaseAdmin();
  // `recovery` y no `invite`: la cuenta ya existe (la crea darAcceso), y el
  // enlace de recuperación es exactamente «pon una contraseña nueva».
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: d.email,
  });
  const token = data?.properties?.hashed_token;
  if (error || !token) {
    console.error("acceso/generateLink:", error?.message);
    return { error: "No se pudo preparar el enlace. Inténtalo de nuevo." };
  }
  const enlace = `${urlPanel()}/admin/acceso?t=${encodeURIComponent(token)}`;
  const r = await sendEmail({
    to: d.email,
    subject: `Tu agenda de ${d.salon.name}, en tu móvil`,
    html: accesoTrabajadorHtml({
      nombre: d.nombre.split(" ")[0] || d.nombre,
      salonName: d.salon.name,
      salonSlug: d.salon.slug,
      salonPhone: d.salon.phone,
      enlace,
    }),
    fromName: d.salon.name,
    // Un token nuevo por envío: cada reenvío es un correo distinto a
    // propósito, y el doble clic del mismo envío lleva el mismo token.
    idempotencyKey: `acceso-trabajador/${token.slice(0, 32)}`,
  });
  if (!r.ok) return { error: "El correo no salió. Prueba «Reenviar enlace» en un rato." };
  return { ok: true };
}

export async function darAcceso(formData: FormData) {
  if (!(await features()).trabajadores) return { error: "Esta función aún no está activada." };
  const employeeId = String(formData.get("employee_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_OK.test(email)) return { error: "Escribe un correo válido." };

  const ctx = await fichaPropia(employeeId);
  if (!ctx || !ctx.emp.active) return { error: "Esa persona no está en tu equipo." };
  if (email === ctx.user.email?.toLowerCase())
    return { error: "Ese es tu correo de dueño: tú ya entras con todo." };

  const admin = supabaseAdmin();
  const { data: ya } = await admin
    .from("employee_access")
    .select("email")
    .eq("employee_id", ctx.emp.id)
    .maybeSingle();
  if (ya) return { error: `Ya tiene acceso con ${ya.email}. Usa «Reenviar enlace».` };

  // La cuenta: nueva, o la que ya exista con ese correo (por ejemplo, si es
  // también cliente y entró alguna vez a su perfil). Se crea con
  // auth.admin.createUser y no por SQL: ver «El aviso al dueño en dev» en
  // CLAUDE.md, un usuario insertado a mano rompe GoTrue.
  const { error: errAlta } = await admin.auth.admin.createUser({ email, email_confirm: true });
  const yaExistia =
    !!errAlta &&
    ((errAlta as { code?: string }).code === "email_exists" ||
      /already|registered|exists/i.test(errAlta.message));
  if (errAlta && !yaExistia) {
    console.error("darAcceso/createUser:", errAlta.message);
    return { error: "No se pudo crear su cuenta. Inténtalo de nuevo." };
  }

  // El id de la cuenta sale del propio enlace, que la busca por correo.
  const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const uid = enlace?.user?.id;
  if (errEnlace || !uid) {
    console.error("darAcceso/generateLink:", errEnlace?.message);
    return { error: "No se pudo preparar su cuenta. Inténtalo de nuevo." };
  }

  // Un dueño no se convierte en trabajador de otro: su /admin es su salón, y
  // mezclar los dos papeles en una cuenta es buscarse un susto.
  const { data: esDueno } = await admin
    .from("salons")
    .select("id")
    .eq("owner_id", uid)
    .limit(1)
    .maybeSingle();
  if (esDueno) return { error: "Ese correo ya es de un dueño de salón. Usa otro." };

  const { error: errVinculo } = await admin.from("employee_access").insert({
    employee_id: ctx.emp.id,
    user_id: uid,
    email,
    last_invited_at: new Date().toISOString(),
  });
  if (errVinculo) {
    if (errVinculo.code === "23505")
      return { error: "Ese correo ya tiene acceso como otro profesional." };
    console.error("darAcceso/insert:", errVinculo.message);
    return { error: "No se pudo dar el acceso. Inténtalo de nuevo." };
  }

  const r = await mandarEnlace({ email, nombre: ctx.emp.name, salon: ctx.salon });
  revalidatePath("/admin/employees");
  if ("error" in r) return { error: `Acceso creado, pero: ${r.error}` };
}

export async function reenviarAcceso(formData: FormData) {
  if (!(await features()).trabajadores) return { error: "Esta función aún no está activada." };
  const ctx = await fichaPropia(String(formData.get("employee_id") ?? ""));
  if (!ctx || !ctx.emp.active) return { error: "Esa persona no está en tu equipo." };

  const admin = supabaseAdmin();
  const { data: acceso } = await admin
    .from("employee_access")
    .select("email, last_invited_at")
    .eq("employee_id", ctx.emp.id)
    .maybeSingle();
  if (!acceso) return { error: "Todavía no tiene acceso." };

  // Freno a la mano nerviosa: cada envío gasta de la cuota de correo
  // compartida (100 al día) con los avisos de citas de verdad.
  const hace = acceso.last_invited_at ? Date.now() - Date.parse(acceso.last_invited_at) : Infinity;
  if (hace < 60_000) return { error: "Acabas de enviárselo. Espera un minuto antes de repetir." };

  const r = await mandarEnlace({ email: acceso.email, nombre: ctx.emp.name, salon: ctx.salon });
  if ("error" in r) return r;
  await admin
    .from("employee_access")
    .update({ last_invited_at: new Date().toISOString() })
    .eq("employee_id", ctx.emp.id);
  revalidatePath("/admin/employees");
}

export async function quitarAcceso(formData: FormData) {
  if (!(await features()).trabajadores) return { error: "Esta función aún no está activada." };
  const ctx = await fichaPropia(String(formData.get("employee_id") ?? ""));
  if (!ctx) return { error: "Esa persona no está en tu equipo." };

  const admin = supabaseAdmin();
  const { data: acceso } = await admin
    .from("employee_access")
    .select("user_id")
    .eq("employee_id", ctx.emp.id)
    .maybeSingle();
  if (!acceso) return;

  const { error } = await admin.from("employee_access").delete().eq("employee_id", ctx.emp.id);
  if (error) return { error: "No se pudo quitar el acceso. Inténtalo de nuevo." };

  // Sin vínculo ya no ve nada —las RPC lo comprueban en cada llamada—. Si la
  // cuenta no sirve para otra cosa, se borra para que no pueda ni entrar. Si
  // es también cliente con perfil, se deja: es su cuenta de cliente.
  const { data: esCliente } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", acceso.user_id)
    .limit(1)
    .maybeSingle();
  if (!esCliente) {
    const { error: errBorrar } = await admin.auth.admin.deleteUser(acceso.user_id);
    if (errBorrar) console.error("quitarAcceso/deleteUser:", errBorrar.message);
  }
  revalidatePath("/admin/employees");
}

export async function renombrarEmpleado(formData: FormData) {
  const nombre = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 2 || nombre.length > 60)
    return { error: "El nombre tiene que tener entre 2 y 60 letras." };
  const ctx = await fichaPropia(String(formData.get("employee_id") ?? ""));
  if (!ctx) return { error: "Esa persona no está en tu equipo." };
  const { error } = await ctx.supabase
    .from("employees")
    .update({ name: nombre })
    .eq("id", ctx.emp.id);
  if (error) return { error: "No se pudo cambiar el nombre. Inténtalo de nuevo." };
  revalidatePath("/admin/employees");
  revalidatePath("/admin");
}

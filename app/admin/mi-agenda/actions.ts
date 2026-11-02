"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { aplicarFalta, redimirFalta } from "@/lib/penalizaciones";
import { miPuesto } from "@/lib/puesto";
import { normalizarTel } from "@/lib/tel";
import { avisarCitaMovida, avisarCitaCancelada, type CitaMovida } from "@/lib/avisos-cita";
import type { AltaOk } from "../actions";

/**
 * El trabajador marca si su cliente vino.
 *
 * La comprobación de verdad está en la RPC `marcar_mi_cita` (0033): solo
 * sus citas, solo el estado, y «atendida»/«no vino» solo cuando la cita ya
 * ha empezado. Si devuelve true, se aplica la misma escalera de faltas que
 * cuando marca el dueño — `aplicarFalta`/`redimirFalta` van con service role
 * y por eso solo se llaman cuando la RPC ha confirmado que la cita es suya.
 */
export async function marcarMiCita(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["confirmed", "completed", "no_show"].includes(status)) return;

  const { data: ok, error } = await supabase.rpc("marcar_mi_cita", {
    p_booking: id,
    p_status: status,
  });
  if (error || !ok) {
    if (error) console.error("marcarMiCita:", error.message);
    return { error: "No se pudo marcar. Si la cita aún no ha empezado, espera a que empiece." };
  }
  if (status === "no_show") await aplicarFalta(id);
  else if (status === "completed") await redimirFalta(id);
  revalidatePath("/admin/mi-agenda");
}

/*
 * Apuntar, mover y cancelar (0034).
 *
 * Las tres siguen el mismo orden: la RPC decide —permiso, salón, a quién
 * pertenece la cita— y solo si dice que sí se usa service role para lo que
 * la sesión del trabajador no alcanza a leer: los datos de contacto que
 * hacen falta para avisar al cliente. Un id de otra peluquería muere en la
 * RPC y nunca llega a la lectura con service role.
 */

/** Los errores que levantan las RPC, dichos para quien está en la silla. */
const MENSAJES: Record<string, string> = {
  sin_permiso: "No tienes permiso para eso. Pídeselo al dueño del salón.",
  profesional_invalido: "Ese profesional ya no está en el equipo.",
  servicio_invalido: "Ese servicio ya no existe.",
  nombre_invalido: "Pon el nombre del cliente.",
  telefono_invalido: "Ese teléfono no parece completo. Repásalo o déjalo vacío.",
  fecha_invalida: "Revisa la fecha y la hora.",
  no_existe: "Esa cita ya no existe.",
  no_activa: "Solo se pueden mover o cancelar citas activas.",
  ya_empezada: "Esa cita ya ha empezado: márcala en vez de moverla o cancelarla.",
  misma_hora: "Esa es la hora que ya tenía.",
  pagada: "Esta cita está pagada online: la cancela el dueño, que es quien devuelve el dinero.",
  demasiadas_reservas:
    "Ese teléfono ya tiene 4 citas pendientes. Para más, que la apunte el dueño.",
};

function traducir(mensaje: string | undefined, porDefecto: string): string {
  if (!mensaje) return porDefecto;
  if (mensaje.includes("no_overlap")) return "Ese profesional ya tiene una cita a esa hora.";
  for (const [clave, texto] of Object.entries(MENSAJES)) {
    if (mensaje.includes(clave)) return texto;
  }
  return porDefecto;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

export async function apuntarCita(
  formData: FormData
): Promise<{ error?: string; ok?: AltaOk }> {
  const puesto = await miPuesto();
  if (!puesto?.apuntar_citas) return { error: MENSAJES.sin_permiso };

  const employeeId = String(formData.get("employee_id") ?? "");
  const serviceId = String(formData.get("service_id") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const nombre = String(formData.get("customer_name") ?? "").trim();
  const telefono = String(formData.get("customer_phone") ?? "").trim();

  if (!employeeId || !serviceId) return { error: "Elige servicio y profesional." };
  if (!FECHA.test(fecha) || !HORA.test(hora)) return { error: MENSAJES.fecha_invalida };
  if (nombre.length < 2) return { error: MENSAJES.nombre_invalido };
  if (telefono && !normalizarTel(telefono)) return { error: MENSAJES.telefono_invalido };

  const { zonedTimeUtc } = await import("@/lib/tz");
  const inicio = zonedTimeUtc(fecha, hora, puesto.timezone);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("apuntar_cita", {
    p_employee: employeeId,
    p_service: serviceId,
    p_starts_at: inicio,
    p_customer_name: nombre,
    p_customer_phone: telefono,
  });
  const fila = ((data as { cita_token: string; cita_fin: string; servicio: string }[] | null) ?? [])[0];
  if (error || !fila) {
    if (error) console.error("apuntarCita:", error.message);
    return { error: traducir(error?.message, "No se pudo apuntar la cita. Inténtalo de nuevo.") };
  }
  revalidatePath("/admin/mi-agenda");

  // Para encadenar la siguiente: la hora a la que queda libre, en la zona
  // del salón, y solo si sigue siendo el mismo día (igual que el dueño).
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: puesto.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(fila.cita_fin));
  const parte = (t: string) => partes.find((p) => p.type === t)!.value;
  const finDia = `${parte("year")}-${parte("month")}-${parte("day")}`;

  return {
    ok: {
      nombre,
      hora,
      fin: finDia === fecha ? `${parte("hour")}:${parte("minute")}` : null,
      fecha,
      employee_id: employeeId,
      public_token: fila.cita_token,
      telefono: telefono ? normalizarTel(telefono) : null,
      servicio: fila.servicio,
    },
  };
}

export async function moverCitaEquipo(formData: FormData) {
  const puesto = await miPuesto();
  if (!puesto?.apuntar_citas) return { error: MENSAJES.sin_permiso };

  const id = String(formData.get("id") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");
  if (!FECHA.test(fecha) || !HORA.test(hora)) return { error: MENSAJES.fecha_invalida };

  const { zonedTimeUtc } = await import("@/lib/tz");
  const inicio = zonedTimeUtc(fecha, hora, puesto.timezone);

  const supabase = await supabaseServer();
  const { data: antes, error } = await supabase.rpc("mover_cita_equipo", {
    p_booking: id,
    p_starts_at: inicio,
  });
  if (error || !antes) {
    if (error) console.error("moverCitaEquipo:", error.message);
    return { error: traducir(error?.message, "No se pudo mover la cita. Inténtalo de nuevo.") };
  }

  const { data: b } = await supabaseAdmin()
    .from("bookings")
    .select(
      "id, customer_name, customer_email, customer_id, public_token, " +
        "services(name), salons(name, slug, phone, timezone)"
    )
    .eq("id", id)
    .maybeSingle();
  if (b) await avisarCitaMovida(b as unknown as CitaMovida, String(antes), inicio);

  revalidatePath("/admin/mi-agenda");
}

export async function cancelarCitaEquipo(formData: FormData) {
  const puesto = await miPuesto();
  if (!puesto?.apuntar_citas) return { error: MENSAJES.sin_permiso };

  const id = String(formData.get("id") ?? "");
  const supabase = await supabaseServer();
  const { data: ok, error } = await supabase.rpc("cancelar_cita_equipo", { p_booking: id });
  if (error || !ok) {
    if (error) console.error("cancelarCitaEquipo:", error.message);
    return { error: traducir(error?.message, "No se pudo cancelar la cita. Inténtalo de nuevo.") };
  }

  const { data: b } = await supabaseAdmin()
    .from("bookings")
    .select("customer_name, customer_email, starts_at, services(name), salons(name, phone, timezone)")
    .eq("id", id)
    .maybeSingle();
  if (b) await avisarCitaCancelada(id, b);

  revalidatePath("/admin/mi-agenda");
}

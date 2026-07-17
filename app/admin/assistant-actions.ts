"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { transcribe, interpretWithTools } from "@/lib/groq";
import { zonedMidnightUtc } from "@/lib/tz";

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type PlanItem =
  | { op: "add_employee"; name: string }
  | { op: "remove_employee"; employee: string }
  | { op: "add_hours"; employee: string; weekdays: number[]; start: string; end: string }
  | { op: "add_service"; name: string; price_eur: number; duration_min: number }
  | { op: "remove_service"; service: string }
  | { op: "set_service_payment"; service: string; type: "none" | "deposit" | "full"; deposit_eur?: number }
  | { op: "add_time_off"; employee: string; from: string; to: string; reason?: string };

const eur = (n: number) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export type PlanStep = { item: PlanItem; desc: string };

function describe(item: PlanItem): string {
  switch (item.op) {
    case "add_employee":
      return `Añadir profesional «${item.name}»`;
    case "remove_employee":
      return `Dar de baja a «${item.employee}»`;
    case "add_hours":
      return `Turno de ${item.employee}: ${item.weekdays.map((d) => DAYS[d]).join(", ")} de ${item.start} a ${item.end}`;
    case "add_service":
      return `Añadir servicio «${item.name}» — ${eur(item.price_eur)}, ${item.duration_min} min`;
    case "remove_service":
      return `Quitar servicio «${item.service}»`;
    case "set_service_payment":
      return item.type === "none"
        ? `«${item.service}»: se paga en el local`
        : item.type === "full"
          ? `«${item.service}»: pago completo al reservar`
          : `«${item.service}»: señal de ${eur(item.deposit_eur ?? 0)} al reservar`;
    case "add_time_off":
      return `Ausencia de ${item.employee}: del ${item.from} al ${item.to}${item.reason ? ` (${item.reason})` : ""}`;
  }
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_employee",
      description: "Añade un profesional/peluquero al equipo",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_employee",
      description: "Da de baja a un profesional existente",
      parameters: {
        type: "object",
        properties: { employee: { type: "string", description: "Nombre del profesional" } },
        required: ["employee"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_hours",
      description:
        "Añade un tramo de horario semanal a un profesional (puede ser recién añadido). Para turno partido, llamar dos veces.",
      parameters: {
        type: "object",
        properties: {
          employee: { type: "string" },
          weekdays: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 6 },
            description: "Días: 0=domingo, 1=lunes ... 6=sábado. 'Toda la semana' en una peluquería = lunes a sábado salvo que digan otra cosa.",
          },
          start: { type: "string", description: "HH:MM" },
          end: { type: "string", description: "HH:MM" },
        },
        required: ["employee", "weekdays", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_service",
      description: "Añade un servicio con precio en euros y duración en minutos",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          price_eur: { type: "number" },
          duration_min: { type: "integer", minimum: 5, maximum: 480 },
        },
        required: ["name", "price_eur", "duration_min"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_service",
      description: "Quita un servicio existente",
      parameters: {
        type: "object",
        properties: { service: { type: "string" } },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_service_payment",
      description: "Configura qué se cobra al reservar un servicio existente",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          type: { type: "string", enum: ["none", "deposit", "full"] },
          deposit_eur: { type: "number", description: "Solo si type=deposit" },
        },
        required: ["service", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_time_off",
      description: "Bloquea días de ausencia/vacaciones de un profesional (fechas YYYY-MM-DD, 'to' incluido)",
      parameters: {
        type: "object",
        properties: {
          employee: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["employee", "from", "to"],
      },
    },
  },
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

async function ownerContext() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("no_session");
  const { data: salon } = await supabase
    .from("salons")
    .select("id, timezone, employees(id, name, active), services(id, name, active)")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) throw new Error("no_salon");
  return {
    supabase,
    salon,
    employees: salon.employees.filter((e) => e.active),
    services: salon.services.filter((s) => s.active),
  };
}

// Audio o texto → plan de acciones a confirmar. No ejecuta nada.
export async function interpretCommand(
  formData: FormData
): Promise<{ steps?: PlanStep[]; heard?: string; error?: string }> {
  let text = String(formData.get("text") ?? "").trim();
  const audio = formData.get("audio");
  try {
    if (!text && audio instanceof Blob && audio.size > 0) {
      text = await transcribe(audio);
    }
    if (!text) return { error: "No he oído nada. Prueba otra vez." };

    const { employees, services, salon } = await ownerContext();
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: salon.timezone });

    const system = `Eres el asistente de configuración de una peluquería. Interpretas órdenes habladas del dueño y las traduces a llamadas de herramientas. Hoy es ${today} (${DAYS[new Date(today + "T12:00:00Z").getUTCDay()]}).
Profesionales actuales: ${employees.map((e) => e.name).join(", ") || "ninguno"}.
Servicios actuales: ${services.map((s) => s.name).join(", ") || "ninguno"}.
Usa los nombres tal y como los diga el usuario. Si la orden menciona a alguien que no existe y pide añadirlo, usa add_employee y luego el resto de herramientas con ese mismo nombre. Si la orden no tiene que ver con estas herramientas, no llames a ninguna y responde brevemente qué no puedes hacer.
Días de la semana (0=domingo … 6=sábado). Los rangos son INCLUSIVOS por ambos lados: «de lunes a sábado» → [1,2,3,4,5,6]; «de lunes a viernes» → [1,2,3,4,5]; «toda la semana» → [1,2,3,4,5,6] (el domingo solo si lo mencionan). Horas como «de 10 a 8» significan 10:00 a 20:00.`;

    const { toolCalls, text: reply } = await interpretWithTools({
      system,
      user: text,
      tools: TOOLS,
    });

    if (toolCalls.length === 0) {
      return { heard: text, error: reply || "No he entendido qué quieres configurar." };
    }

    const steps: PlanStep[] = [];
    const pendingEmployees = new Set(employees.map((e) => norm(e.name)));
    const pendingServices = new Set(services.map((s) => norm(s.name)));

    for (const c of toolCalls) {
      const a = c.args as Record<string, never>;
      let item: PlanItem | null = null;
      switch (c.name) {
        case "add_employee":
          if (typeof a.name === "string" && (a.name as string).trim().length >= 2) {
            item = { op: "add_employee", name: (a.name as string).trim() };
            pendingEmployees.add(norm(item.name));
          }
          break;
        case "remove_employee":
          if (pendingEmployees.has(norm(String(a.employee ?? ""))))
            item = { op: "remove_employee", employee: String(a.employee) };
          break;
        case "add_hours": {
          const wd = Array.isArray(a.weekdays)
            ? (a.weekdays as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
            : [];
          if (
            pendingEmployees.has(norm(String(a.employee ?? ""))) &&
            wd.length > 0 &&
            HHMM.test(String(a.start)) &&
            HHMM.test(String(a.end)) &&
            String(a.start) < String(a.end)
          ) {
            item = {
              op: "add_hours",
              employee: String(a.employee),
              weekdays: [...new Set(wd)].sort(),
              start: String(a.start),
              end: String(a.end),
            };
          }
          break;
        }
        case "add_service": {
          const price = Number(a.price_eur);
          const dur = Number(a.duration_min);
          if (
            typeof a.name === "string" &&
            (a.name as string).trim() &&
            price >= 0 &&
            dur >= 5 &&
            dur <= 480
          ) {
            item = {
              op: "add_service",
              name: (a.name as string).trim(),
              price_eur: price,
              duration_min: Math.round(dur),
            };
            pendingServices.add(norm(item.name));
          }
          break;
        }
        case "remove_service":
          if (pendingServices.has(norm(String(a.service ?? ""))))
            item = { op: "remove_service", service: String(a.service) };
          break;
        case "set_service_payment": {
          const t = String(a.type);
          const dep = a.deposit_eur == null ? undefined : Number(a.deposit_eur);
          if (
            pendingServices.has(norm(String(a.service ?? ""))) &&
            ["none", "deposit", "full"].includes(t) &&
            (t !== "deposit" || (dep && dep > 0))
          ) {
            item = {
              op: "set_service_payment",
              service: String(a.service),
              type: t as "none" | "deposit" | "full",
              deposit_eur: dep,
            };
          }
          break;
        }
        case "add_time_off": {
          const from = String(a.from ?? "");
          const to = String(a.to ?? from);
          if (
            pendingEmployees.has(norm(String(a.employee ?? ""))) &&
            YMD.test(from) &&
            YMD.test(to) &&
            to >= from
          ) {
            item = {
              op: "add_time_off",
              employee: String(a.employee),
              from,
              to,
              reason: a.reason ? String(a.reason) : undefined,
            };
          }
          break;
        }
      }
      if (item) steps.push({ item, desc: describe(item) });
    }

    if (steps.length === 0) {
      return {
        heard: text,
        error:
          "He entendido la orden pero no he podido validarla (¿nombre inexistente o datos incompletos?).",
      };
    }
    return { heard: text, steps };
  } catch (e) {
    console.error("[asistente] error interpretando:", e);
    return { error: "El asistente no está disponible ahora mismo. Inténtalo de nuevo." };
  }
}

// Ejecuta un plan ya confirmado por el dueño. RLS aplica: sesión del dueño.
export async function executePlan(
  steps: PlanStep[]
): Promise<{ results: { desc: string; ok: boolean }[] }> {
  const { supabase, salon } = await ownerContext();
  const results: { desc: string; ok: boolean }[] = [];
  const employeeId = new Map(
    salon.employees.filter((e) => e.active).map((e) => [norm(e.name), e.id])
  );
  const serviceId = new Map(
    salon.services.filter((s) => s.active).map((s) => [norm(s.name), s.id])
  );
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  for (const { item, desc } of steps.slice(0, 20)) {
    let ok = false;
    try {
      switch (item.op) {
        case "add_employee": {
          const { data } = await supabase
            .from("employees")
            .insert({ salon_id: salon.id, name: item.name })
            .select("id")
            .single();
          if (data) {
            employeeId.set(norm(item.name), data.id);
            ok = true;
          }
          break;
        }
        case "remove_employee": {
          const id = employeeId.get(norm(item.employee));
          if (id) {
            const { error } = await supabase
              .from("employees")
              .update({ active: false })
              .eq("id", id);
            ok = !error;
          }
          break;
        }
        case "add_hours": {
          const id = employeeId.get(norm(item.employee));
          if (id) {
            const rows = item.weekdays.map((weekday) => ({
              employee_id: id,
              weekday,
              start_min: toMin(item.start),
              end_min: toMin(item.end),
            }));
            const { error } = await supabase.from("working_hours").insert(rows);
            ok = !error;
          }
          break;
        }
        case "add_service": {
          const { data } = await supabase
            .from("services")
            .insert({
              salon_id: salon.id,
              name: item.name,
              price_cents: Math.round(item.price_eur * 100),
              duration_min: item.duration_min,
            })
            .select("id")
            .single();
          if (data) {
            serviceId.set(norm(item.name), data.id);
            ok = true;
          }
          break;
        }
        case "remove_service": {
          const id = serviceId.get(norm(item.service));
          if (id) {
            const { error } = await supabase
              .from("services")
              .update({ active: false })
              .eq("id", id);
            ok = !error;
          }
          break;
        }
        case "set_service_payment": {
          const id = serviceId.get(norm(item.service));
          if (id) {
            const { error } = await supabase
              .from("services")
              .update({
                payment_type: item.type,
                deposit_cents:
                  item.type === "deposit" ? Math.round((item.deposit_eur ?? 0) * 100) : null,
              })
              .eq("id", id);
            ok = !error;
          }
          break;
        }
        case "add_time_off": {
          const id = employeeId.get(norm(item.employee));
          if (id) {
            const end = new Date(item.to + "T12:00:00Z");
            end.setUTCDate(end.getUTCDate() + 1);
            const { error } = await supabase.from("time_off").insert({
              employee_id: id,
              starts_at: zonedMidnightUtc(item.from, salon.timezone),
              ends_at: zonedMidnightUtc(end.toISOString().slice(0, 10), salon.timezone),
              reason: item.reason ?? null,
            });
            ok = !error;
          }
          break;
        }
      }
    } catch (e) {
      console.error("[asistente] error ejecutando", item.op, e);
    }
    results.push({ desc, ok });
  }

  revalidatePath("/admin", "layout");
  return { results };
}

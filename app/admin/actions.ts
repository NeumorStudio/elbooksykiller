"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendEmail, cancellationHtml } from "@/lib/email";
import { aplicarFalta, redimirFalta } from "@/lib/penalizaciones";
import { sesionAdmin } from "@/lib/sesion-admin";

// Comprueba sesión y que el salón no esté bloqueado por el superadmin.
const db = sesionAdmin;

/*
 * Aquí vivía `createSalon`: cualquiera con cuenta se daba de alta y publicaba
 * un salón, con el código de invitación (`ALTA_INVITACION`) como único freno
 * y solo si la variable estaba puesta.
 *
 * Ahora las altas las hacemos nosotros a mano: el cliente nos da su email,
 * le creamos la cuenta en Supabase Auth con su contraseña y le insertamos la
 * fila en `salons`. Quitar el formulario no bastaba —la política RLS dejaba
 * insertar con la clave pública desde el navegador—, así que el cierre real
 * es la migración 0023: `salons` ya no acepta INSERT de `authenticated`.
 * Solo entra por service role, o sea por nosotros.
 */

export async function addService(formData: FormData) {
  const { supabase } = await db();
  const { error } = await supabase.from("services").insert({
    salon_id: String(formData.get("salon_id")),
    name: String(formData.get("name") ?? "").trim(),
    price_cents: Math.round(Number(formData.get("price") ?? 0) * 100),
    duration_min: Number(formData.get("duration") ?? 30),
  });
  if (error) return { error: "No se pudo añadir el servicio. Revisa precio y duración." };
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
  if (error) return { error: "No se pudo añadir. Inténtalo de nuevo." };
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Pon la fecha de inicio." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
    return { error: "La fecha «hasta» no puede ser anterior al inicio." };

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
  if (error) return { error: "No se pudo bloquear. Inténtalo de nuevo." };
  revalidatePath("/admin/employees");
}

export async function deleteTimeOff(formData: FormData) {
  const { supabase } = await db();
  await supabase.from("time_off").delete().eq("id", String(formData.get("id")));
  revalidatePath("/admin/employees");
}

// addHours() y deleteHours() se han quitado al llegar guardarHorario().
// No era solo limpieza: una server action exportada es un endpoint que
// cualquiera con sesión puede llamar, y addHours era precisamente la que
// permitía dejar dos tramos solapados el mismo día — el fallo que se acaba
// de cerrar. Dejarla ahí habría mantenido el agujero abierto por detrás.

/**
 * Fija el horario de unos días concretos, sustituyendo lo que hubiera.
 *
 * addHours() solo sabe AÑADIR tramos, y ese es justo el problema: para
 * partir una jornada de 10-20 había que borrar el tramo, crear el de mañana
 * y crear el de tarde — tres pasos, y en medio el empleado se quedaba sin
 * horario y desaparecía de la web de reservas. Peor: nada impedía dejar dos
 * tramos solapados, y en producción pasó (10:00-14:00 junto a 04:00-21:00,
 * que ofrecía huecos a las cuatro de la madrugada).
 *
 * Aquí el borrado y la inserción son una sola operación sobre los días
 * elegidos, así que el estado intermedio no existe y el solape no se puede
 * construir: dos tramos del mismo día vienen siempre de este formulario,
 * que valida que la tarde empiece después de acabar la mañana.
 */
export async function guardarHorario(formData: FormData) {
  const { supabase } = await db();
  const employeeId = String(formData.get("employee_id"));
  const modo = String(formData.get("modo"));
  const weekdays = [...new Set(formData.getAll("weekday").map(Number))].filter(
    (d) => d >= 0 && d <= 6
  );
  if (weekdays.length === 0) return { error: "Elige al menos un día." };

  const tramos: [number, number][] = [];
  if (modo === "continua") {
    const a = toMin(String(formData.get("inicio")));
    const b = toMin(String(formData.get("fin")));
    if (b <= a) return { error: "La hora de cierre debe ser posterior a la de apertura." };
    tramos.push([a, b]);
  } else if (modo === "partida") {
    const m1 = toMin(String(formData.get("m_inicio")));
    const m2 = toMin(String(formData.get("m_fin")));
    const t1 = toMin(String(formData.get("t_inicio")));
    const t2 = toMin(String(formData.get("t_fin")));
    if (m2 <= m1) return { error: "El tramo de mañana termina antes de empezar." };
    if (t2 <= t1) return { error: "El tramo de tarde termina antes de empezar." };
    if (t1 < m2) return { error: "La tarde no puede empezar antes de que acabe la mañana." };
    tramos.push([m1, m2], [t1, t2]);
  } else if (modo !== "cerrado") {
    return { error: "Elige jornada continua, partida o cerrado." };
  }

  // La RLS de working_hours ya comprueba que el empleado es de un salón de
  // quien firma; si no lo es, esto afecta a cero filas.
  const { error: errBorrado } = await supabase
    .from("working_hours")
    .delete()
    .eq("employee_id", employeeId)
    .in("weekday", weekdays);
  if (errBorrado) return { error: "No se pudo guardar el horario. Inténtalo de nuevo." };

  if (tramos.length > 0) {
    const { error } = await supabase.from("working_hours").insert(
      weekdays.flatMap((weekday) =>
        tramos.map(([start_min, end_min]) => ({
          employee_id: employeeId,
          weekday,
          start_min,
          end_min,
        }))
      )
    );
    if (error) return { error: "No se pudo guardar el horario. Inténtalo de nuevo." };
  }
  revalidatePath("/admin/employees");
}

// Dar de baja es reversible: `active` es una bandera, no un borrado. Sin
// esta acción, un clic por error en "Dar de baja" era definitivo desde el
// panel — y el empleado de temporada que vuelve obligaba a crearlo de nuevo,
// perdiendo el vínculo con su historial de citas.
export async function reactivarEmpleado(formData: FormData) {
  const { supabase } = await db();
  await supabase
    .from("employees")
    .update({ active: true })
    .eq("id", String(formData.get("id")));
  revalidatePath("/admin/employees");
}

// Copiar el horario de un compañero. En un salón pequeño casi todo el mundo
// hace las mismas horas, así que dar de alta a alguien son dos clics en vez
// de rellenar catorce campos.
export async function copiarHorario(formData: FormData) {
  const { supabase, user } = await db();
  const destino = String(formData.get("destino"));
  const origen = String(formData.get("origen"));
  if (!origen) return { error: "Elige de quién copiar el horario." };
  if (origen === destino) return { error: "Ese es su propio horario." };

  // Los dos tienen que ser del salón de quien firma, y hay que comprobarlo
  // a mano: `public_read_hours` es `using (true)`, así que la RLS deja leer
  // el horario de CUALQUIER empleado, y el `with check` de la inserción
  // solo mira el destino. Sin esto, un `origen` cambiado en el formulario
  // copia el horario de un empleado de otro salón — el selector solo ofrece
  // compañeros, pero el selector es cliente.
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería en la Agenda." };

  const { data: propios } = await supabase
    .from("employees")
    .select("id")
    .eq("salon_id", salon.id)
    .in("id", [origen, destino]);
  if ((propios?.length ?? 0) !== 2) return { error: "Esa persona no es de tu equipo." };

  const { data: filas } = await supabase
    .from("working_hours")
    .select("weekday, start_min, end_min")
    .eq("employee_id", origen);
  if (!filas?.length) return { error: "Esa persona todavía no tiene horario." };

  await supabase.from("working_hours").delete().eq("employee_id", destino);
  const { error } = await supabase
    .from("working_hours")
    .insert(filas.map((f) => ({ ...f, employee_id: destino })));
  if (error) return { error: "No se pudo copiar el horario. Inténtalo de nuevo." };
  revalidatePath("/admin/employees");
}

/**
 * Cierra el salón un día suelto: festivo local, mudanza, lo que sea.
 *
 * Por debajo es una ausencia para cada persona del equipo, porque `time_off`
 * cuelga del empleado y no del salón. Se expone aparte porque nadie busca
 * "bloquear ausencias" cuando lo que quiere decir es "el 15 no abro", y
 * porque hacerlo a mano son tantas operaciones como empleados.
 */
export async function cerrarDia(formData: FormData) {
  const { supabase, user } = await db();
  const dia = String(formData.get("dia"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { error: "Elige la fecha que cierras." };

  const { data: salon } = await supabase
    .from("salons")
    .select("timezone, employees(id, active)")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería en la Agenda." };

  const activos = (salon.employees as { id: string; active: boolean }[]).filter((e) => e.active);
  if (activos.length === 0) return { error: "No hay nadie en el equipo a quien cerrarle el día." };

  const tz = salon.timezone ?? "Europe/Madrid";
  const fin = new Date(dia);
  fin.setDate(fin.getDate() + 1); // ends_at es exclusivo
  const motivo = String(formData.get("motivo") ?? "").trim() || "Cerrado";

  const { error } = await supabase.from("time_off").insert(
    activos.map((e) => ({
      employee_id: e.id,
      starts_at: zonedMidnightUtc(dia, tz),
      ends_at: zonedMidnightUtc(fin.toISOString().slice(0, 10), tz),
      reason: motivo,
    }))
  );
  if (error) return { error: "No se pudo cerrar el día. Inténtalo de nuevo." };
  revalidatePath("/admin/employees");
}

/**
 * Marca el estado de una cita ya pasada o en curso.
 *
 * La BD admitía 'completed' y 'no_show' desde el día uno, pero no había
 * forma de llegar a ellos desde la interfaz — así que el KPI "No
 * presentados" de Estadísticas mostraba siempre 0. Sin esto no hay
 * baseline con el que medir si los recordatorios sirven de algo.
 */
export async function setBookingStatus(formData: FormData) {
  const { supabase } = await db();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["confirmed", "completed", "no_show"].includes(status)) return;
  // .select() confirma que RLS dejó tocar la fila: la escalera de faltas va
  // con service role y no debe dispararse con ids de citas ajenas.
  const { data: tocada } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  // Escalera de faltas: "no vino" suma falta, "atendida" redime una.
  if (tocada && status === "no_show") await aplicarFalta(id);
  else if (tocada && status === "completed") await redimirFalta(id);
  revalidatePath("/admin");
}

export async function cancelBooking(formData: FormData) {
  const { supabase } = await db();
  const id = String(formData.get("id"));

  // Leer antes de cancelar (RLS: solo el dueño llega aquí con datos)
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "customer_name, customer_email, starts_at, payment_status, stripe_session_id, services(name), salons(name, phone, timezone, stripe_account_id)"
    )
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", id);

  // Si el cliente había pagado, devolverle el dinero. Antes se cancelaba la
  // cita y el cobro se quedaba hecho, sin aviso ni en la interfaz ni al
  // cliente: dinero real de una persona real que no volvía.
  if (!error && b?.payment_status === "paid" && b.stripe_session_id) {
    const salon = b.salons as unknown as { stripe_account_id: string | null };
    try {
      const { stripe } = await import("@/lib/stripe");
      const cuenta = salon.stripe_account_id
        ? { stripeAccount: salon.stripe_account_id }
        : undefined;
      // retrieve() separa params de opciones: {} es el hueco de los params.
      const sesion = await stripe.checkout.sessions.retrieve(b.stripe_session_id, {}, cuenta);
      if (sesion.payment_intent) {
        await stripe.refunds.create(
          {
            payment_intent: String(sesion.payment_intent),
            reason: "requested_by_customer",
          },
          // Clave de idempotencia: si el dueño pulsa dos veces, un solo
          // reembolso.
          { ...cuenta, idempotencyKey: `refund-${id}` }
        );
        // No se marca payment_status: su CHECK solo admite none|pending|paid.
        // El registro del reembolso vive en Stripe; para reflejarlo aquí hace
        // falta una migración que añada 'refunded' al constraint.
      }
    } catch (e) {
      // No romper la cancelación por un fallo de reembolso: la cita queda
      // cancelada y el dueño ve el aviso para devolverlo a mano.
      console.error(`[refund] no se pudo reembolsar la reserva ${id}:`, e);
    }
  }

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

/**
 * Alta manual de cita desde el panel: el cliente que llama o entra por la
 * puerta. Era el mayor hueco funcional — la única escritura sobre
 * `bookings` desde el panel era cancelar, así que el dueño tenía que abrir
 * su propia web pública y reservar como si fuera un cliente.
 *
 * Va por INSERT directo con la sesión del dueño, no por la RPC
 * `create_booking`: esa valida horarios y ausencias, y el dueño necesita
 * poder meter al de las 20:55 que entra cuando ya está cerrando. La
 * protección contra doble reserva la sigue dando la exclusion constraint
 * `no_overlap` de la base de datos, que es la garantía de verdad.
 */
/**
 * Lo que el alta manual devuelve al panel cuando sale bien.
 *
 * `fin` es la hora a la que queda libre el profesional, y es lo que permite
 * encadenar la cita siguiente sin volver a elegir nada.
 */
export type AltaOk = {
  nombre: string;
  hora: string;
  fin: string | null;
  fecha: string;
  employee_id: string;
};

export async function addBooking(
  formData: FormData
): Promise<{ error?: string; ok?: AltaOk }> {
  const { supabase, user } = await db();

  const { data: salon } = await supabase
    .from("salons")
    .select("id, timezone")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const employeeId = String(formData.get("employee_id") ?? "");
  const serviceId = String(formData.get("service_id") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const nombre = String(formData.get("customer_name") ?? "").trim();
  const telefono = String(formData.get("customer_phone") ?? "").trim();

  if (!employeeId || !serviceId) return { error: "Elige servicio y profesional." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora))
    return { error: "Revisa la fecha y la hora." };
  if (nombre.length < 2) return { error: "Pon el nombre del cliente." };

  const { data: servicio } = await supabase
    .from("services")
    .select("duration_min")
    .eq("id", serviceId)
    .eq("salon_id", salon.id)
    .maybeSingle();
  if (!servicio) return { error: "Ese servicio no existe." };

  // La hora la escribe el dueño en horario local del salón; hay que
  // convertirla al instante absoluto que guarda la columna timestamptz.
  const { zonedTimeUtc } = await import("@/lib/tz");
  const inicio = zonedTimeUtc(fecha, hora, salon.timezone);
  const fin = new Date(new Date(inicio).getTime() + servicio.duration_min * 60000).toISOString();

  const { error } = await supabase.from("bookings").insert({
    salon_id: salon.id,
    employee_id: employeeId,
    service_id: serviceId,
    customer_name: nombre,
    // El cliente de mostrador puede no dar teléfono; la columna es NOT NULL.
    customer_phone: telefono || "—",
    starts_at: inicio,
    ends_at: fin,
    status: "confirmed",
  });

  if (error) {
    return {
      error: error.message.includes("no_overlap")
        ? "Ese profesional ya tiene una cita a esa hora."
        : "No se pudo crear la cita. Revisa los datos.",
    };
  }
  revalidatePath("/admin");

  // Modo encadenar: el padre y el hijo entran juntos, o la clienta se hace
  // color y corte. Devolver la hora a la que queda libre el profesional
  // evita volver a elegir día, hora y profesional con la gente delante.
  //
  // La hora de fin se saca del instante `fin` ya calculado y no de sumar
  // minutos a la de inicio: en un domingo de cambio de hora esa suma se
  // desvía sesenta minutos. Y se compara el día, porque un servicio que
  // termina pasada la medianoche no se encadena en la misma fecha.
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: salon.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(fin));
  const parte = (t: string) => partes.find((p) => p.type === t)!.value;
  const finDia = `${parte("year")}-${parte("month")}-${parte("day")}`;
  const finHora = `${parte("hour")}:${parte("minute")}`;

  return {
    ok: {
      nombre,
      hora,
      fin: finDia === fecha ? finHora : null,
      fecha,
      employee_id: employeeId,
    },
  };
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
  if (!["none", "deposit", "full"].includes(type)) return { error: "Elige un tipo de cobro." };
  const deposit = Math.round(Number(formData.get("deposit") ?? 0) * 100);
  if (type === "deposit" && deposit <= 0)
    return { error: "Pon el importe de la señal (mayor que 0)." };
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

/**
 * URL de la ficha de Google del salón. Se ofrece tras valorar en privado,
 * a TODOS por igual — el review gating está prohibido.
 */
export async function guardarGoogleUrl(formData: FormData) {
  const { resenas } = await (await import("@/lib/features")).features();
  if (!resenas) return { error: "Todavía no está activada." };

  const { supabase, user } = await db();
  const url = String(formData.get("google_review_url") ?? "").trim();
  if (url && !/^https:\/\/(g\.page|maps\.app\.goo\.gl|search\.google\.com|www\.google\.[a-z.]+)\//i.test(url))
    return { error: "Pega el enlace de tu ficha de Google (empieza por https://g.page o maps.app.goo.gl)." };

  const { error } = await supabase
    .from("salons")
    .update({ google_review_url: url || null })
    .eq("owner_id", user.id);
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath("/admin/website");
}

export async function setCustomDomain(formData: FormData) {
  const { supabase, user } = await db();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(domain) || domain.endsWith(".vercel.app")) {
    return { error: "Eso no parece un dominio válido (ej. www.barberiapaco.com)." };
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
    return {
      error: error.message.includes("custom_domain")
        ? "Ese dominio ya está conectado a otro salón."
        : "No se pudo conectar el dominio. Inténtalo de nuevo.",
    };
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

export async function dismissOnboarding() {
  const { supabase, user } = await db();
  await supabase.from("salons").update({ onboarded: true }).eq("owner_id", user.id);
  revalidatePath("/admin");
}

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // SVG fuera: el bucket es público, así que un .svg con <script> quedaba
  // como página ejecutable alojada bajo el dominio de nuestro proveedor.
};

export async function uploadLogo(formData: FormData) {
  const { supabase, user } = await db();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige una imagen." };
  if (!LOGO_TYPES[file.type]) return { error: "Formato no válido: usa PNG, JPG o WebP." };
  if (file.size > 2 * 1024 * 1024) return { error: "Máximo 2 MB. Reduce la imagen e inténtalo." };

  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const admin = supabaseAdmin();
  const path = `${salon.id}.${LOGO_TYPES[file.type]}`;
  const { error: upErr } = await admin.storage
    .from("logos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { error: "No se pudo subir el logo. Inténtalo de nuevo." };

  const { data: pub } = admin.storage.from("logos").getPublicUrl(path);
  await supabase
    .from("salons")
    .update({ logo_url: `${pub.publicUrl}?v=${Math.trunc(Math.random() * 1e9)}` })
    .eq("id", salon.id);
  revalidatePath("/admin/website");
}

/*
  Galería de trabajos. Deliberadamente SIN columna nueva: las fotos viven
  en el bucket `logos` bajo `galeria/<salon_id>/`, y la web las lista de
  ahí. Así no hace falta migración ni tocar el esquema que mantiene el
  compañero — el orden lo da el nombre del fichero.
*/
// Sin export: en un fichero "use server" todo export debe ser async.
const galeriaDe = (salonId: string) => `galeria/${salonId}`;

export async function uploadFotos(formData: FormData) {
  const { supabase, user } = await db();
  const files = formData.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Elige al menos una foto." };
  if (files.length > 12) return { error: "Máximo 12 fotos de una vez." };

  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return { error: "Primero crea tu peluquería." };

  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const admin = supabaseAdmin();
  const { data: yaHay } = await admin.storage.from("logos").list(galeriaDe(salon.id));
  let n = yaHay?.length ?? 0;

  for (const file of files) {
    if (!LOGO_TYPES[file.type]) return { error: `"${file.name}": usa PNG, JPG o WebP.` };
    if (file.size > 3 * 1024 * 1024) return { error: `"${file.name}" pasa de 3 MB.` };
    // Prefijo numérico con relleno: el orden alfabético del listado es el
    // orden en que se ven en la web.
    const ext = LOGO_TYPES[file.type];
    const nombre = `${String(n).padStart(3, "0")}-${Date.now()}.${ext}`;
    const { error } = await admin.storage
      .from("logos")
      .upload(`${galeriaDe(salon.id)}/${nombre}`, file, { contentType: file.type });
    if (error) return { error: "No se pudo subir alguna foto. Inténtalo de nuevo." };
    n++;
  }

  revalidatePath("/admin/website");
  revalidatePath("/", "layout");
}

export async function removeFoto(formData: FormData) {
  const { supabase, user } = await db();
  const nombre = String(formData.get("nombre") ?? "");
  if (!nombre) return;
  const { data: salon } = await supabase
    .from("salons")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon) return;
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  // Solo el nombre de fichero: evita que un path manipulado salga de la
  // carpeta del salón.
  const seguro = nombre.split("/").pop()!;
  await supabaseAdmin()
    .storage.from("logos")
    .remove([`${galeriaDe(salon.id)}/${seguro}`]);
  revalidatePath("/admin/website");
  revalidatePath("/", "layout");
}

export async function removeLogo() {
  const { supabase, user } = await db();
  const { data: salon } = await supabase
    .from("salons")
    .select("id, logo_url")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!salon?.logo_url) return;
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const path = salon.logo_url.split("/logos/")[1]?.split("?")[0];
  if (path) await supabaseAdmin().storage.from("logos").remove([path]);
  await supabase.from("salons").update({ logo_url: null }).eq("id", salon.id);
  revalidatePath("/admin/website");
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

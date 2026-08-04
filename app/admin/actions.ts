"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendEmail, cancellationHtml } from "@/lib/email";
import { aplicarFalta, redimirFalta } from "@/lib/penalizaciones";
import { normalizarTel } from "@/lib/tel";
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

/**
 * Cambiar una cita de día o de hora.
 *
 * Faltaba, y era el hueco más grande del panel: la única forma de mover a
 * alguien era cancelar y crear otra cita. Eso le manda al cliente un correo
 * de «tu cita se ha cancelado» —que es exactamente lo contrario de lo que
 * ha pasado—, le rompe el enlace que tenía guardado y le deja sin
 * recordatorio. Y es la llamada más habitual que recibe un salón: «no llego
 * a las seis, ¿me lo pasas a las ocho?».
 *
 * Aquí se cambia la fila, así que el token del cliente sigue valiendo, su
 * enlace enseña la hora nueva y el .ics se regenera solo.
 *
 * No se valida contra el horario de apertura, igual que al crear a mano: el
 * dueño manda sobre su agenda —una cita a las 21:30 por un favor es asunto
 * suyo—. Lo que sí protege la base es el solape, que no es una opinión.
 */
export async function moverCita(formData: FormData) {
  const { supabase } = await db();
  const id = String(formData.get("id") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora))
    return { error: "Revisa la fecha y la hora." };

  // RLS: si la cita no es de un salón suyo, esto no devuelve nada.
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, status, starts_at, customer_name, customer_email, customer_id, public_token, " +
        "services(name, duration_min), salons(name, slug, phone, timezone)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) return { error: "Esa cita no existe." };

  const cita = b as unknown as {
    id: string; status: string; starts_at: string; customer_name: string;
    customer_email: string | null; customer_id: string | null;
    public_token?: string;
    services: { name: string; duration_min: number };
    salons: { name: string; slug: string; phone: string | null; timezone: string };
  };

  // Mover una cita cancelada o ya cerrada no significa nada: si el cliente
  // vuelve, es una cita nueva.
  if (!["confirmed", "pending_payment"].includes(cita.status))
    return { error: "Solo se pueden mover las citas activas." };

  const { zonedTimeUtc } = await import("@/lib/tz");
  const inicio = zonedTimeUtc(fecha, hora, cita.salons.timezone);
  const fin = new Date(
    new Date(inicio).getTime() + cita.services.duration_min * 60000
  ).toISOString();

  if (new Date(inicio).getTime() === new Date(cita.starts_at).getTime())
    return { error: "Esa es la hora que ya tenía." };

  const { error } = await supabase
    .from("bookings")
    .update({ starts_at: inicio, ends_at: fin })
    .eq("id", id);
  if (error) {
    return {
      error: error.message.includes("no_overlap")
        ? "Ese profesional ya tiene una cita a esa hora."
        : "No se pudo mover la cita. Inténtalo de nuevo.",
    };
  }

  /**
   * Los recordatorios ya mandados dejan de valer.
   *
   * Si la cita era mañana y ya se le avisó la víspera, al moverla a la
   * semana que viene ese turno tiene que soltarse: si no, el cliente se
   * queda sin el aviso de su fecha nueva. Borrar la fila es volver a la
   * casilla de salida.
   */
  const { recordatorios } = await (await import("@/lib/features")).features();
  if (recordatorios) {
    // Con service role: la tabla de turnos no tiene políticas a propósito
    // (misma decisión que push_subscriptions), así que la sesión del dueño
    // no la ve.
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    await supabaseAdmin().from("reminders").delete().eq("booking_id", id);
  }

  // Avisar al cliente: mover su cita sin decírselo es plantarle a él.
  const cuando = new Date(inicio).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: cita.salons.timezone,
  });
  const antes = new Date(cita.starts_at).toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: cita.salons.timezone,
  });
  const citaUrl = cita.public_token
    ? `${(await import("@/lib/urls")).baseUrl()}/cita/${cita.public_token}`
    : undefined;

  // Push primero, correo si no llegó: la misma escalera que el recordatorio,
  // por la cuota de 100 correos al día.
  let avisado = false;
  if (cita.customer_id) {
    const { enviarPush } = await import("@/lib/push");
    const entregados = await enviarPush(cita.customer_id, {
      titulo: `Tu cita en ${cita.salons.name} ha cambiado de hora`,
      cuerpo: `Ahora es el ${cuando}. Toca para verla.`,
      url: citaUrl ?? `${(await import("@/lib/urls")).baseUrl()}/${cita.salons.slug}`,
      tag: `movida-${id}`,
    });
    avisado = entregados > 0;
  }
  if (!avisado && cita.customer_email) {
    const { bookingMovedHtml } = await import("@/lib/email");
    await sendEmail({
      to: cita.customer_email,
      subject: `Tu cita en ${cita.salons.name} cambia al ${cuando}`,
      html: bookingMovedHtml({
        customerName: cita.customer_name,
        salonName: cita.salons.name,
        salonSlug: cita.salons.slug,
        salonPhone: cita.salons.phone,
        serviceName: cita.services.name,
        antes,
        ahora: cuando,
        citaUrl,
      }),
      // Cada movimiento es un aviso distinto: la clave lleva la hora nueva,
      // porque mover dos veces la misma cita son dos correos legítimos.
      idempotencyKey: `booking-moved/${id}/${inicio}`,
      fromName: cita.salons.name,
    });
  }

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

  // Marcada como del salón: estas nunca cuentan como cancelación tardía del
  // cliente (ver migración 0026).
  const { cancelaciones } = await (await import("@/lib/features")).features();
  const { error } = await supabase
    .from("bookings")
    .update(
      cancelaciones
        ? { status: "cancelled", cancelled_by: "salon" }
        : { status: "cancelled" }
    )
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

  /**
   * El teléfono sigue siendo opcional, pero si se escribe tiene que valer.
   *
   * Es lo que crea la ficha del cliente —el trigger de la 0006 la saca del
   * teléfono normalizado—, y con ella vienen la tarjeta de fidelidad, los
   * recordatorios y los avisos en el móvil. Un número mal escrito no falla:
   * `normalizar_tel` devuelve null, la cita se guarda igual y el cliente se
   * queda fuera de todo eso sin que nadie se entere. Pasó de verdad — en el
   * salón piloto, cuatro de las primeras catorce citas tenían teléfono en
   * pantalla y ninguna ficha detrás.
   */
  if (telefono && !normalizarTel(telefono))
    return { error: "Ese teléfono no parece completo. Repásalo o déjalo vacío." };

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
  /**
   * Se aceptan todas las formas en que Google reparte el mismo sitio.
   *
   * Antes solo entraban `g.page` y compañía, y el enlace que da hoy el botón
   * de compartir de una ficha —`share.google/...`— se rechazaba: el dueño
   * pega lo que Google le ha dado, la web le dice que está mal, y acaba
   * dejándolo vacío. Que la lista la marque Google, no nosotros.
   *
   * Lo ideal sigue siendo el de «pedir reseñas» (`g.page/r/…`), que abre
   * directamente el cuadro de escribir; los demás llevan a la ficha y hay
   * que buscar el botón. Eso se explica en la pantalla, no se impone aquí.
   */
  if (
    url &&
    !/^https:\/\/(g\.page|g\.co|share\.google|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+|search\.google\.com|www\.google\.[a-z.]+)\//i.test(url)
  )
    return {
      error: "Pega un enlace de Google (g.page, share.google, maps.app.goo.gl…).",
    };

  const { error } = await supabase
    .from("salons")
    .update({ google_review_url: url || null })
    .eq("owner_id", user.id);
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath("/admin/website");
}

/**
 * Fecha de apertura del salón.
 *
 * Hasta ahora `opens_at` solo se podía tocar con un UPDATE a mano en la
 * base: la web decía «Abrimos el 7 de agosto» y si la inauguración se movía,
 * el cartel seguía mintiendo hasta que alguien entraba a la base. Es el dato
 * que más cambia justo antes de abrir y el único sin sitio en el panel.
 *
 * Vacío = ya está abierto, que es el estado normal de un salón en marcha.
 * No se rechazan fechas pasadas: una fecha ya cumplida se comporta como
 * vacía —la web deja de anunciarla sola— y prohibirlas obligaría a limpiar
 * el campo a mano el día después de abrir.
 */
export async function guardarApertura(formData: FormData) {
  const { supabase, user } = await db();
  const fecha = String(formData.get("opens_at") ?? "").trim();

  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return { error: "Revisa la fecha." };
  // Date la acepta como UTC, que aquí da igual: solo se comprueba que exista
  // (un 31 de febrero se cuela por el patrón pero no por esto).
  if (fecha && Number.isNaN(new Date(`${fecha}T12:00:00Z`).getTime()))
    return { error: "Esa fecha no existe." };

  const { error } = await supabase
    .from("salons")
    .update({ opens_at: fecha || null })
    .eq("owner_id", user.id);
  if (error) return { error: "No se pudo guardar. Inténtalo de nuevo." };

  revalidatePath("/admin/website");
  // La web pública lee esta fecha en cada visita, pero la del salón se
  // revalida igual por si el aviso está en caché de router en otra pestaña.
  revalidatePath("/[slug]", "page");
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

/**
 * Ata este móvil a la cuenta del dueño para recibir sus avisos.
 *
 * La credencial es la sesión, no un token de cita: aquí no hay reserva que
 * demuestre nada, y quien está dentro del panel es quien es. `onConflict` en
 * endpoint para que volver a activarlo en el mismo móvil actualice en vez de
 * duplicar — el navegador puede rotar las claves manteniendo el endpoint.
 */
export async function guardarPushDueno(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ error?: string }> {
  const { user } = await db();
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: "Suscripción incompleta." };
  }

  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const { error } = await supabaseAdmin().from("push_subscriptions").upsert(
    {
      user_id: user.id,
      // El CHECK de la 0028 exige uno de los dos y solo uno: si este móvil
      // estaba suscrito como cliente, pasa a ser del dueño.
      customer_id: null,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      fallos: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("guardarPushDueno:", error.message);
    return { error: "No se pudo activar el aviso. Inténtalo de nuevo." };
  }
  return {};
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

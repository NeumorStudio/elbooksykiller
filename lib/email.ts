import { Resend } from "resend";

// Sin RESEND_API_KEY los envíos se saltan en silencio: el email nunca
// debe romper una reserva.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "Salonio <onboarding@resend.dev>";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
};

export type SendResult = { ok: boolean; error?: string };

/**
 * Nunca lanza — un fallo de email no debe romper una reserva —, pero sí
 * devuelve el resultado. El cron de newsletter lo necesita: antes marcaba
 * cada envío como 'sent' pasara lo que pasara, así que una campaña con el
 * dominio sin verificar en Resend figuraba como "Enviada" con cero entregas.
 */
export async function sendEmail({
  to,
  subject,
  html,
  idempotencyKey,
}: SendArgs): Promise<SendResult> {
  if (!resend) {
    console.warn(`[email] sin RESEND_API_KEY: no se envía "${subject}" a ${to}`);
    return { ok: false, error: "RESEND_API_KEY ausente" };
  }
  const { error } = await resend.emails.send(
    { from: FROM, to: [to], subject, html },
    { idempotencyKey }
  );
  if (error) {
    console.error(`[email] fallo enviando "${subject}" a ${to}:`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Escapa lo que viene del cliente final antes de interpolarlo en el HTML.
 *
 * El nombre solo se valida por longitud (≥2), así que un cliente podía
 * llamarse `<img src=x onerror=...>` y ese marcado llegaba crudo al buzón
 * del dueño.
 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

// Los espacios en un href tel: los cortan algunos marcadores de Android.
const telAttr = (phone: string) =>
  `tel:${phone.trim().startsWith("+") ? "+" : ""}${phone.replace(/[^\d]/g, "")}`;

const wrap = (title: string, body: string) => `
<div style="margin:0 auto;max-width:480px;font-family:system-ui,sans-serif;color:#2b2620">
  <div style="padding:28px 24px;border:1px solid #e4ded4;border-radius:12px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#8a6410">${title}</h1>
    ${body}
  </div>
  <p style="text-align:center;font-size:12px;color:#8d857a;margin-top:12px">Reservas por Salonio</p>
</div>`;

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#8d857a">${label}</td><td style="padding:4px 0;font-weight:600">${value}</td></tr>`;

export type BookingEmailData = {
  salonName: string;
  salonPhone: string | null;
  serviceName: string;
  employeeName: string;
  when: string; // ya formateado en la zona del salón
  price: string;
  customerName: string;
  customerPhone: string;
  // URL permanente de la cita (/cita/[token]); ausente hasta que la
  // migración 0006 esté aplicada.
  citaUrl?: string;
};

// Botón de email: enlaces con pinta de acción, compatibles con clientes viejos.
const boton = (href: string, texto: string) =>
  `<a href="${href}" style="display:inline-block;padding:10px 20px;background:#8a6410;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${texto}</a>`;

export function customerConfirmationHtml(d: BookingEmailData) {
  return wrap(
    `Cita confirmada en ${esc(d.salonName)}`,
    `<table style="font-size:14px">${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${row("Cuándo", esc(d.when))}${row("Precio", esc(d.price))}</table>
     <p style="font-size:14px;margin:16px 0 0">Te esperamos, ${esc(d.customerName)}.${
       d.salonPhone ? ` Si no puedes venir, avísanos al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a>.` : ""
     }</p>${
       d.citaUrl
         ? `<p style="margin:18px 0 0">${boton(d.citaUrl, "Ver o cancelar mi cita")}</p>
            <p style="font-size:12px;color:#8d857a;margin:8px 0 0">Guarda este enlace: es tu cita, sin cuentas ni contraseñas.</p>`
         : ""
     }`
  );
}

export function ownerNotificationHtml(d: BookingEmailData) {
  return wrap(
    `Nueva reserva: ${esc(d.serviceName)}`,
    `<table style="font-size:14px">${row("Cuándo", esc(d.when))}${row("Cliente", esc(d.customerName))}${row("Teléfono", `<a href="${telAttr(d.customerPhone)}">${esc(d.customerPhone)}</a>`)}${row("Con", esc(d.employeeName))}${row("Precio", esc(d.price))}</table>`
  );
}

export function faltaHtml(d: {
  customerName: string;
  salonName: string;
  salonPhone: string | null;
  nivel: "aviso" | "bloqueo" | "veto";
  hasta?: string; // fecha formateada, solo para nivel "bloqueo"
}) {
  const llamar = d.salonPhone
    ? ` Si hubo un problema de verdad, llámanos al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a> y lo hablamos.`
    : " Si hubo un problema de verdad, dínoslo en tu próxima visita y lo hablamos.";
  const cuerpo =
    d.nivel === "aviso"
      ? `Tu última cita en <b>${esc(d.salonName)}</b> quedó sin asistir. Sabemos que puede pasar — pero ese hueco lo pierde otro cliente y el salón. Si se repite, la reserva online se bloqueará temporalmente.${llamar}`
      : d.nivel === "bloqueo"
        ? `Por citas sin asistir, tu reserva online en <b>${esc(d.salonName)}</b> queda pausada hasta el <b>${esc(d.hasta ?? "")}</b>. Cada cita a la que asistas después limpia una falta.${llamar}`
        : // El veto no caduca solo, y quien lo tiene no puede reservar: sin
          // decirle por dónde se sale, la escalera acaba en un muro y el
          // salón pierde al cliente sin enterarse. El bloqueo es de la
          // reserva *online*, no de la puerta del local — que se note.
          `Por faltas repetidas, la reserva online en <b>${esc(d.salonName)}</b> queda cerrada. No es una puerta cerrada: ${
            d.salonPhone
              ? `puedes seguir pidiendo cita llamando al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a>`
              : "puedes seguir pidiendo cita en el salón"
          }, y cuando vuelvas a venir con normalidad te reactivamos la reserva por internet.`;
  return wrap(
    d.nivel === "aviso" ? "Te esperamos y no viniste" : "Reserva online pausada",
    `<p style="font-size:14px;margin:0">Hola ${esc(d.customerName)}: ${cuerpo}</p>`
  );
}

export function cancellationHtml(d: Omit<BookingEmailData, "customerPhone" | "price">) {
  return wrap(
    `Tu cita en ${esc(d.salonName)} se ha cancelado`,
    `<p style="font-size:14px;margin:0">Hola ${esc(d.customerName)}: tu cita de <b>${esc(d.serviceName)}</b> (${esc(d.when)}) ha sido cancelada por el salón.${
      d.salonPhone ? ` Para reprogramar, llámanos al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a> o reserva de nuevo online.` : " Puedes reservar de nuevo online cuando quieras."
    }</p>`
  );
}

export function reminderHtml(
  d: Omit<BookingEmailData, "customerPhone"> & { salonAddress: string | null }
) {
  return wrap(
    `En 1 hora: tu cita en ${esc(d.salonName)}`,
    `<p style="font-size:14px;margin:0 0 14px">Hola ${esc(d.customerName)} 👋 Te recordamos tu cita:</p>
     <table style="font-size:14px">${row("Cuándo", esc(d.when))}${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${
       d.salonAddress ? row("Dónde", esc(d.salonAddress)) : ""
     }</table>
     <p style="font-size:14px;margin:16px 0 0">Si no puedes venir, avísanos cuanto antes${
       d.salonPhone ? ` al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a>` : ""
     } y liberamos el hueco para otra persona. Cancelar a última hora deja la silla vacía (${esc(d.price)}).</p>${
       d.citaUrl ? `<p style="margin:18px 0 0">${boton(d.citaUrl, "Ver o cancelar mi cita")}</p>` : ""
     }`
  );
}

/** Aviso al dueño cuando es el CLIENTE quien cancela desde su enlace. */
export function ownerCancelledByCustomerHtml(d: {
  customerName: string;
  serviceName: string;
  when: string;
  refunded: boolean;
}) {
  return wrap(
    `Cancelación: ${esc(d.serviceName)} — ${esc(d.when)}`,
    `<p style="font-size:14px;margin:0">${esc(d.customerName)} ha cancelado su cita de <b>${esc(d.serviceName)}</b> (${esc(d.when)}) desde su enlace. El hueco queda libre en tu agenda.${
      d.refunded ? " El pago se le ha devuelto automáticamente." : ""
    }</p>`
  );
}

/** Aviso al dueño de una valoración baja: la oportunidad de arreglarlo. */
export function ownerLowRatingHtml(d: {
  customerName: string;
  serviceName: string;
  when: string;
  rating: number;
}) {
  return wrap(
    `Valoración de ${d.rating}/5 de ${esc(d.customerName)}`,
    `<p style="font-size:14px;margin:0">${esc(d.customerName)} ha valorado con <b>${d.rating}/5</b> su cita de ${esc(d.serviceName)} (${esc(d.when)}). Esta nota es privada: nadie más la ve. Una llamada a tiempo vale más que una reseña.</p>`
  );
}

/**
 * Petición de valoración tras el servicio. La nota es privada (para el
 * salón); el enlace lleva a /cita/[token]#valorar, donde después de valorar
 * se ofrece Google a todo el mundo por igual — nunca solo a los contentos.
 */
export function resenaHtml(d: {
  salonName: string;
  customerName: string;
  citaUrl: string;
  sellos?: { tiene: number; requiere: number; premio: string } | null;
}) {
  return wrap(
    `¿Qué tal fue tu visita a ${esc(d.salonName)}?`,
    `<p style="font-size:14px;margin:0 0 16px">Hola ${esc(d.customerName)}: gracias por venir. Nos ayuda mucho saber cómo lo hicimos — es un toque, y es privado.</p>
     <p style="margin:0">${boton(`${d.citaUrl}#valorar`, "Valorar mi visita")}</p>${
       d.sellos
         ? `<p style="font-size:14px;margin:18px 0 0;padding:12px;background:#faf6ec;border-radius:8px">🎯 Tu tarjeta: <b>${d.sellos.tiene} de ${d.sellos.requiere}</b> visitas. ${
             d.sellos.tiene >= d.sellos.requiere
               ? `¡<b>${esc(d.sellos.premio)}</b> conseguido! Díselo al equipo en tu próxima visita.`
               : `A ${d.sellos.requiere - d.sellos.tiene} de: ${esc(d.sellos.premio)}.`
           }</p>`
         : ""
     }`
  );
}

/**
 * Newsletter del salón. El cuerpo lo escribe el dueño como texto plano y se
 * escapa aquí — nunca HTML crudo (misma inyección que ya se arregló arriba).
 * La baja va en cada envío, a un clic y sin login: art. 21 LSSI-CE.
 */
export function newsletterHtml(d: {
  salonName: string;
  body: string;
  bajaUrl: string;
}) {
  const cuerpo = esc(d.body)
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:14px;margin:0 0 14px;white-space:pre-line">${p}</p>`)
    .join("");
  return wrap(
    esc(d.salonName),
    `${cuerpo}
     <p style="font-size:12px;color:#8d857a;margin:20px 0 0;border-top:1px solid #e4ded4;padding-top:12px">
       Recibes este correo porque aceptaste recibir novedades de ${esc(d.salonName)} al reservar.
       <a href="${d.bajaUrl}" style="color:#8d857a">Darme de baja</a>
     </p>`
  );
}

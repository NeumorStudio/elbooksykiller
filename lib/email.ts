import { Resend } from "resend";

// Sin RESEND_API_KEY los envíos se saltan en silencio: el email nunca
// debe romper una reserva.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "ElBooksyKiller <onboarding@resend.dev>";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
};

export async function sendEmail({ to, subject, html, idempotencyKey }: SendArgs) {
  if (!resend) return;
  const { error } = await resend.emails.send(
    { from: FROM, to: [to], subject, html },
    { idempotencyKey }
  );
  if (error) console.error(`[email] fallo enviando "${subject}" a ${to}:`, error.message);
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
  <p style="text-align:center;font-size:12px;color:#8d857a;margin-top:12px">Reservas por ElBooksyKiller</p>
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
};

export function customerConfirmationHtml(d: BookingEmailData) {
  return wrap(
    `Cita confirmada en ${esc(d.salonName)}`,
    `<table style="font-size:14px">${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${row("Cuándo", esc(d.when))}${row("Precio", esc(d.price))}</table>
     <p style="font-size:14px;margin:16px 0 0">Te esperamos, ${esc(d.customerName)}.${
       d.salonPhone ? ` Si no puedes venir, avísanos al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a>.` : ""
     }</p>`
  );
}

export function ownerNotificationHtml(d: BookingEmailData) {
  return wrap(
    `Nueva reserva: ${esc(d.serviceName)}`,
    `<table style="font-size:14px">${row("Cuándo", esc(d.when))}${row("Cliente", esc(d.customerName))}${row("Teléfono", `<a href="${telAttr(d.customerPhone)}">${esc(d.customerPhone)}</a>`)}${row("Con", esc(d.employeeName))}${row("Precio", esc(d.price))}</table>`
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
    `Mañana tienes cita en ${esc(d.salonName)}`,
    `<p style="font-size:14px;margin:0 0 14px">Hola ${esc(d.customerName)} 👋 Te recordamos tu cita:</p>
     <table style="font-size:14px">${row("Cuándo", esc(d.when))}${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${
       d.salonAddress ? row("Dónde", esc(d.salonAddress)) : ""
     }</table>
     <p style="font-size:14px;margin:16px 0 0">Si no puedes venir, avísanos cuanto antes${
       d.salonPhone ? ` al <a href="${telAttr(d.salonPhone)}">${esc(d.salonPhone)}</a>` : ""
     } y liberamos el hueco para otra persona. Cancelar a última hora deja la silla vacía (${esc(d.price)}).</p>`
  );
}

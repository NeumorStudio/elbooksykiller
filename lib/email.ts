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
    `Cita confirmada en ${d.salonName}`,
    `<table style="font-size:14px">${row("Servicio", d.serviceName)}${row("Con", d.employeeName)}${row("Cuándo", d.when)}${row("Precio", d.price)}</table>
     <p style="font-size:14px;margin:16px 0 0">Te esperamos, ${d.customerName}.${
       d.salonPhone ? ` Si no puedes venir, avísanos al <a href="tel:${d.salonPhone}">${d.salonPhone}</a>.` : ""
     }</p>`
  );
}

export function ownerNotificationHtml(d: BookingEmailData) {
  return wrap(
    `Nueva reserva: ${d.serviceName}`,
    `<table style="font-size:14px">${row("Cuándo", d.when)}${row("Cliente", d.customerName)}${row("Teléfono", `<a href="tel:${d.customerPhone}">${d.customerPhone}</a>`)}${row("Con", d.employeeName)}${row("Precio", d.price)}</table>`
  );
}

export function cancellationHtml(d: Omit<BookingEmailData, "customerPhone" | "price">) {
  return wrap(
    `Tu cita en ${d.salonName} se ha cancelado`,
    `<p style="font-size:14px;margin:0">Hola ${d.customerName}: tu cita de <b>${d.serviceName}</b> (${d.when}) ha sido cancelada por el salón.${
      d.salonPhone ? ` Para reprogramar, llámanos al <a href="tel:${d.salonPhone}">${d.salonPhone}</a> o reserva de nuevo online.` : " Puedes reservar de nuevo online cuando quieras."
    }</p>`
  );
}

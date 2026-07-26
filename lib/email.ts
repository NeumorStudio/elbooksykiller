import { Resend } from "resend";
import { baseUrl } from "@/lib/urls";

// Sin RESEND_API_KEY los envíos se saltan en silencio: el email nunca
// debe romper una reserva.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "Salonio <onboarding@resend.dev>";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  /**
   * Nombre que verá el cliente como remitente. Sin esto todos los correos
   * llegaban de «Reservas», que no le dice nada a quien reservó en una
   * peluquería concreta: en la bandeja, junto a diez remitentes más, «Paye
   * Villalobos» se reconoce y «Reservas» se ignora o se marca como spam.
   * La dirección no cambia — sigue siendo la del dominio verificado.
   */
  fromName?: string;
};

// «Nombre <correo@dominio>» → se queda con el correo para poder cambiarle
// el nombre delante sin tocar la configuración.
const DIRECCION = FROM.match(/<([^>]+)>/)?.[1] ?? FROM;

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
  fromName,
}: SendArgs): Promise<SendResult> {
  if (!resend) {
    console.warn(`[email] sin RESEND_API_KEY: no se envía "${subject}" a ${to}`);
    return { ok: false, error: "RESEND_API_KEY ausente" };
  }
  // Comillas fuera del nombre: un salón llamado `Paye "El Rápido"` rompía
  // la cabecera From y el envío entero se caía.
  const from = fromName
    ? `${fromName.replace(/["<>\r\n]/g, "").trim()} <${DIRECCION}>`
    : FROM;
  const { error } = await resend.emails.send(
    { from, to: [to], subject, html },
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

/**
 * Paleta de la web, traída al correo.
 *
 * Son los tokens OKLCH de DESIGN.md convertidos a hex: en un email no hay
 * variables CSS ni oklch() —Outlook y Gmail lo ignoran—, así que van fijos.
 * Si se cambia la paleta de la web, hay que volver a convertirlos o el
 * correo dejará de parecerse a la página a la que lleva.
 */
const C = {
  fondo: "#1f2023", // un punto por debajo del bg de la web: da marco a la tarjeta
  tarjeta: "#292a2d",
  linea: "#3d3e42",
  ink: "#edeef1",
  muted: "#aeafb2",
  faint: "#88898c",
  oro: "#e9b44b",
  oroInk: "#1b150b",
} as const;

// Fraunces y Geist no se pueden cargar en un correo: Georgia hace de
// display —también es serif con carácter— y la pila del sistema, de texto.
const DISPLAY = "Georgia,'Times New Roman',serif";
const TEXTO = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type Marca = {
  salonName: string;
  /** Para el logo: se sirve en PNG desde /[slug]/pwa-icon. */
  salonSlug?: string;
  salonPhone?: string | null;
  salonAddress?: string | null;
};

/**
 * La cabecera con el logo del salón.
 *
 * El logo va por la ruta pwa-icon y no por `logo_url` a propósito: los
 * logos se guardan en WebP, que **Outlook no pinta** — el cliente vería un
 * hueco roto justo en la parte que da confianza. Esa ruta ya convierte a
 * PNG con sharp para el icono de la PWA, así que sirve igual aquí.
 */
const cabecera = (m?: Marca) => {
  if (!m) return "";
  const logo = m.salonSlug
    ? `<img src="${baseUrl()}/${encodeURIComponent(m.salonSlug)}/pwa-icon?size=180"
         width="56" height="56" alt=""
         style="display:block;margin:0 auto 12px;border-radius:14px;border:1px solid ${C.linea}">`
    : "";
  return `${logo}
    <p style="margin:0;text-align:center;font-family:${DISPLAY};font-size:19px;letter-spacing:.01em;color:${C.ink}">${esc(m.salonName)}</p>
    <div style="height:1px;margin:18px 0 22px;background:${C.linea}"></div>`;
};

const pie = (m?: Marca) => {
  const datos = [
    m?.salonAddress ? esc(m.salonAddress) : null,
    m?.salonPhone ? `<a href="${telAttr(m.salonPhone)}" style="color:${C.muted};text-decoration:none">${esc(m.salonPhone)}</a>` : null,
  ].filter(Boolean);
  return `
    ${datos.length ? `<p style="margin:0 0 6px;font-size:12px;color:${C.muted}">${datos.join(" · ")}</p>` : ""}
    <p style="margin:0;font-size:11px;color:${C.faint}">Reservas por Salonio</p>`;
};

/**
 * Maqueta base. Tablas y estilos en línea porque un correo no tiene
 * hojas de estilo fiables, y `bgcolor` además de `background` porque
 * Outlook ignora el segundo en algunos contextos.
 *
 * `preheader` es la línea que la bandeja de entrada enseña junto al asunto.
 * Sin ella, ahí se cuela el primer texto del cuerpo —normalmente «Hola
 * Fulano»— y se desaprovecha el único sitio donde se decide si se abre.
 */
const wrap = (title: string, body: string, m?: Marca, preheader?: string) => `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.fondo};color:${C.ink}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background:${C.fondo}">
  <tr><td align="center" style="padding:28px 14px 34px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
      <tr><td bgcolor="${C.tarjeta}" style="background:${C.tarjeta};border:1px solid ${C.linea};border-radius:14px;padding:28px 26px">
        ${cabecera(m)}
        <h1 style="margin:0 0 18px;font-family:${DISPLAY};font-size:23px;line-height:1.25;font-weight:normal;color:${C.oro}">${title}</h1>
        <div style="font-family:${TEXTO};font-size:15px;line-height:1.55;color:${C.ink}">${body}</div>
      </td></tr>
      <tr><td align="center" style="padding:18px 8px 0;font-family:${TEXTO}">${pie(m)}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

const row = (label: string, value: string) =>
  `<tr>
     <td style="padding:7px 14px 7px 0;color:${C.muted};font-size:14px;white-space:nowrap;vertical-align:top">${label}</td>
     <td style="padding:7px 0;font-weight:600;font-size:15px;color:${C.ink}">${value}</td>
   </tr>`;

export type BookingEmailData = {
  salonName: string;
  salonPhone: string | null;
  // Para el logo y el pie del correo. Opcionales: sin ellos el email sale
  // igual, solo que sin marca — nunca deben impedir que se envíe.
  salonSlug?: string;
  salonAddress?: string | null;
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
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
     <td bgcolor="${C.oro}" style="background:${C.oro};border-radius:10px">
       <a href="${href}" style="display:inline-block;padding:12px 24px;color:${C.oroInk};text-decoration:none;font-weight:700;font-size:15px;font-family:${TEXTO}">${texto}</a>
     </td>
   </tr></table>`;

// Los datos de marca que lleva toda cita: se extraen una vez y se pasan a
// wrap(), en vez de repetir los cuatro campos en cada plantilla.
const marcaDe = (d: BookingEmailData): Marca => ({
  salonName: d.salonName,
  salonSlug: d.salonSlug,
  salonPhone: d.salonPhone,
  salonAddress: d.salonAddress,
});

export function customerConfirmationHtml(d: BookingEmailData) {
  return wrap(
    "Tu cita está confirmada",
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${row("Cuándo", esc(d.when))}${row("Precio", esc(d.price))}</table>
     <p style="margin:20px 0 0">Te esperamos, ${esc(d.customerName)}.${
       d.salonPhone ? ` Si no puedes venir, avísanos al <a href="${telAttr(d.salonPhone)}" style="color:${C.oro}">${esc(d.salonPhone)}</a> y liberamos el hueco.` : ""
     }</p>${
       d.citaUrl
         ? `<div style="margin:22px 0 0">${boton(d.citaUrl, "Ver o cancelar mi cita")}</div>
            <p style="font-size:12px;color:${C.muted};margin:10px 0 0">Guarda este enlace: es tu cita, sin cuentas ni contraseñas.</p>`
         : ""
     }`,
    marcaDe(d),
    `${d.when} · ${d.serviceName} con ${d.employeeName}`
  );
}

export function ownerNotificationHtml(d: BookingEmailData) {
  return wrap(
    `Nueva reserva: ${esc(d.serviceName)}`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${row("Cuándo", esc(d.when))}${row("Cliente", esc(d.customerName))}${row("Teléfono", `<a href="${telAttr(d.customerPhone)}" style="color:${C.oro}">${esc(d.customerPhone)}</a>`)}${row("Con", esc(d.employeeName))}${row("Precio", esc(d.price))}</table>`,
    marcaDe(d),
    `${d.customerName} · ${d.when}`
  );
}

export function faltaHtml(d: {
  customerName: string;
  salonName: string;
  salonSlug?: string;
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
    `<p style="margin:0">Hola ${esc(d.customerName)}: ${cuerpo}</p>`,
    { salonName: d.salonName, salonSlug: d.salonSlug, salonPhone: d.salonPhone }
  );
}

export function cancellationHtml(d: Omit<BookingEmailData, "customerPhone" | "price">) {
  return wrap(
    "Tu cita se ha cancelado",
    `<p style="margin:0">Hola ${esc(d.customerName)}: tu cita de <b>${esc(d.serviceName)}</b> (${esc(d.when)}) ha sido cancelada por el salón.${
      d.salonPhone ? ` Para reprogramar, llámanos al <a href="${telAttr(d.salonPhone)}" style="color:${C.oro}">${esc(d.salonPhone)}</a> o reserva de nuevo online.` : " Puedes reservar de nuevo online cuando quieras."
    }</p>`,
    marcaDe(d as BookingEmailData),
    `${d.serviceName} · ${d.when}`
  );
}

export function reminderHtml(
  d: Omit<BookingEmailData, "customerPhone"> & { salonAddress: string | null }
) {
  return wrap(
    "En 1 hora tienes tu cita",
    `<p style="margin:0 0 16px">Hola ${esc(d.customerName)}, te recordamos tu cita:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0">${row("Cuándo", esc(d.when))}${row("Servicio", esc(d.serviceName))}${row("Con", esc(d.employeeName))}${
       d.salonAddress ? row("Dónde", esc(d.salonAddress)) : ""
     }</table>
     <p style="margin:20px 0 0">Si no puedes venir, avísanos cuanto antes${
       d.salonPhone ? ` al <a href="${telAttr(d.salonPhone)}" style="color:${C.oro}">${esc(d.salonPhone)}</a>` : ""
     } y liberamos el hueco para otra persona. Cancelar a última hora deja la silla vacía (${esc(d.price)}).</p>${
       d.citaUrl ? `<div style="margin:22px 0 0">${boton(d.citaUrl, "Ver o cancelar mi cita")}</div>` : ""
     }`,
    marcaDe(d as BookingEmailData),
    `${d.when} · ${d.serviceName}`
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
  salonSlug?: string;
  customerName: string;
  citaUrl: string;
  sellos?: { tiene: number; requiere: number; premio: string } | null;
}) {
  return wrap(
    "¿Qué tal fue tu visita?",
    `<p style="margin:0 0 18px">Hola ${esc(d.customerName)}: gracias por venir. Nos ayuda mucho saber cómo lo hicimos — es un toque, y es privado.</p>
     <div style="margin:0">${boton(`${d.citaUrl}#valorar`, "Valorar mi visita")}</div>${
       d.sellos
         ? `<p style="font-size:14px;margin:22px 0 0;padding:14px;background:${C.fondo};border:1px solid ${C.linea};border-radius:10px">Tu tarjeta: <b style="color:${C.oro}">${d.sellos.tiene} de ${d.sellos.requiere}</b> visitas. ${
             d.sellos.tiene >= d.sellos.requiere
               ? `¡<b>${esc(d.sellos.premio)}</b> conseguido! Díselo al equipo en tu próxima visita.`
               : `A ${d.sellos.requiere - d.sellos.tiene} de: ${esc(d.sellos.premio)}.`
           }</p>`
         : ""
     }`,
    { salonName: d.salonName, salonSlug: d.salonSlug },
    "Un toque y nos cuentas cómo fue. Es privado."
  );
}

/**
 * Newsletter del salón. El cuerpo lo escribe el dueño como texto plano y se
 * escapa aquí — nunca HTML crudo (misma inyección que ya se arregló arriba).
 * La baja va en cada envío, a un clic y sin login: art. 21 LSSI-CE.
 */
export function newsletterHtml(d: {
  salonName: string;
  salonSlug?: string;
  body: string;
  bajaUrl: string;
}) {
  const cuerpo = esc(d.body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;white-space:pre-line">${p}</p>`)
    .join("");
  return wrap(
    esc(d.salonName),
    `${cuerpo}
     <p style="font-size:12px;color:${C.muted};margin:22px 0 0;border-top:1px solid ${C.linea};padding-top:14px">
       Recibes este correo porque aceptaste recibir novedades de ${esc(d.salonName)} al reservar.
       <a href="${d.bajaUrl}" style="color:${C.muted}">Darme de baja</a>
     </p>`,
    { salonName: d.salonName, salonSlug: d.salonSlug },
    // El primer párrafo hace de línea de preview: es la promoción misma.
    esc(d.body).split(/\n/)[0]?.slice(0, 120)
  );
}

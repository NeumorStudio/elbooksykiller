import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El .ics de la cita, servido como fichero de verdad.
 *
 * Antes se generaba en la página como `data:text/calendar,...` en el href.
 * Eso falla justo donde más se usa: los navegadores móviles y los webviews
 * de Gmail y Outlook —que es donde se abre el enlace del email— **bloquean
 * la navegación a URLs `data:`**, así que el botón no hacía nada y no daba
 * ni error. Una ruta normal se descarga en todas partes, y en iOS abre
 * directamente el diálogo de «añadir a Calendario».
 *
 * Y el contenido tampoco era válido: sin PRODID, UID ni DTSTAMP el fichero
 * incumple el RFC 5545 y varias aplicaciones lo rechazan sin decir por qué.
 */

// Comas, puntos y comas y barras son separadores en iCalendar: sin escapar,
// una dirección como «Calle X, 41009 Sevilla» parte el campo en dos y el
// evento entra con la ubicación cortada o directamente corrupto.
const esc = (t: string) =>
  t.replace(/\\/g, "\\\\").replace(/[;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

const fecha = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");

/**
 * Las líneas de más de 75 octetos hay que plegarlas (RFC 5545 §3.1) o el
 * fichero es inválido. Un nombre de salón largo con dirección se pasa sin
 * esfuerzo.
 */
function plegar(linea: string) {
  if (linea.length <= 73) return linea;
  const trozos = [linea.slice(0, 73)];
  for (let i = 73; i < linea.length; i += 72) trozos.push(" " + linea.slice(i, i + 72));
  return trozos.join("\r\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return new NextResponse(null, { status: 404 });

  const { data } = await supabaseAdmin()
    .from("bookings")
    .select("id, status, starts_at, ends_at, services(name), salons(name, address)")
    .eq("public_token", token)
    .maybeSingle();
  if (!data) return new NextResponse(null, { status: 404 });

  const b = data as unknown as {
    id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    services: { name: string };
    salons: { name: string; address: string | null };
  };

  const inicio = new Date(b.starts_at);
  const fin = new Date(b.ends_at);
  const titulo = `${b.services.name} en ${b.salons.name}`;

  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salonio//Reservas//ES",
    "CALSCALE:GREGORIAN",
    // PUBLISH y no REQUEST: es una copia informativa, no una invitación que
    // espere respuesta del cliente.
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // UID estable: si el cliente lo añade dos veces, el calendario actualiza
    // el evento en vez de duplicarlo.
    `UID:${b.id}@salonio`,
    `DTSTAMP:${fecha(new Date())}`,
    `DTSTART:${fecha(inicio)}`,
    `DTEND:${fecha(fin)}`,
    plegar(`SUMMARY:${esc(titulo)}`),
    ...(b.salons.address ? [plegar(`LOCATION:${esc(b.salons.address)}`)] : []),
    // Una cita cancelada que ya esté en el calendario del cliente se marca
    // como tal en lugar de quedarse ahí como si siguiera en pie.
    `STATUS:${b.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    plegar(`DESCRIPTION:${esc(titulo)}`),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF obligatorio: el LF suelto rompe el formato en algunos clientes.
  return new NextResponse(lineas.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cita.ics"',
      "Cache-Control": "no-store",
    },
  });
}

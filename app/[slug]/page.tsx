import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import LinkCargando from "@/app/link-cargando";
import BookingWidget from "./booking-widget";
import InstallPrompt from "./install-prompt";
import BarraInferior from "./barra-inferior";
import ModoReserva from "./modo-reserva";
import LogoInicio from "./logo-inicio";
import VideoFondo from "../video-fondo";
import Carrusel from "./carrusel";
import { confirmPaidSession } from "./actions";
import { fotosDelSalon } from "./galeria";
import { telHref } from "@/lib/tel";
import { mapaUrl } from "@/lib/mapa";
import { features } from "@/lib/features";
import { estadoSalon, moduloActivo } from "@/lib/modulos";
import { baseUrl } from "@/lib/urls";

export const viewport = { themeColor: "#1b1712" };

// "Abierto ahora · hasta las 20:00" a partir de los horarios del equipo
// (públicos desde el día uno, pero la página nunca los consultaba). El
// salón está abierto si algún profesional trabaja a esta hora.
type Tramo = { weekday: number; start_min: number; end_min: number };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

function estadoApertura(tramos: Tramo[], timezone: string) {
  const ahora = new Date();
  const [h, min] = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(ahora).split(":").map(Number);
  const minutos = h * 60 + min;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(ahora)
  );

  const abiertoHasta = tramos
    .filter((t) => t.weekday === dow && t.start_min <= minutos && minutos < t.end_min)
    .reduce((max, t) => Math.max(max, t.end_min), 0);
  if (abiertoHasta) return { abierto: true, texto: `Abierto ahora · hasta las ${hhmm(abiertoHasta)}` };

  const hoyMasTarde = tramos
    .filter((t) => t.weekday === dow && t.start_min > minutos)
    .sort((a, b) => a.start_min - b.start_min)[0];
  if (hoyMasTarde) return { abierto: false, texto: `Cerrado · abre hoy a las ${hhmm(hoyMasTarde.start_min)}` };

  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    const primero = tramos.filter((t) => t.weekday === d).sort((a, b) => a.start_min - b.start_min)[0];
    if (primero) {
      const cuando = i === 1 ? "mañana" : `el ${DIAS[d]}`;
      return { abierto: false, texto: `Cerrado · abre ${cuando} a las ${hhmm(primero.start_min)}` };
    }
  }
  return null;
}

// La pestaña y el preview de WhatsApp muestran el salón, no la plataforma
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  /**
   * Con service role, no con la sesión anónima.
   *
   * `blocked` no está entre las columnas que `anon` puede leer —la migración
   * 0016 recortó el SELECT columna a columna, porque la clave anónima viaja
   * en el navegador—, así que pedirla con la sesión pública no devuelve la
   * fila recortada: falla la consulta entera y el salón parece no existir.
   */
  const { data: salon, error } = await supabaseAdmin()
    .from("salons")
    .select("name, address, custom_domain, blocked")
    .eq("slug", slug)
    .maybeSingle();

  /**
   * Un fallo de la consulta NO es un salón inexistente.
   *
   * `maybeSingle()` devuelve `data: null` en los dos casos: cuando no hay
   * fila y cuando la petición se cayó. Si se tratan igual, un timeout de la
   * base convierte la web de un salón que está cogiendo citas en un «no
   * encontrado» — y el cliente que iba a reservar se va. Ante la duda se
   * sigue adelante con metadata neutra: el cuerpo de la página hace su propia
   * consulta y ya decide él. Un <title> genérico durante un hipo de la base
   * es infinitamente más barato que una web caída.
   */
  if (error) return {};

  /**
   * Un salón bloqueado se trata como uno inexistente también aquí.
   *
   * El cuerpo de la página ya decía "no encontrado" —sin formulario ni
   * servicios—, pero el <title> seguía enseñando su nombre: generateMetadata
   * corre por su cuenta y no miraba `blocked`. Se veía al compartir el enlace
   * por WhatsApp, que lee el título y la descripción.
   *
   * Lo que NO arregla esto es el código de estado: sigue siendo 200. Con un
   * `loading.tsx` en el segmento, la respuesta empieza a enviarse en cuanto la
   * página suspende, y las cabeceras ya han salido cuando se descubre que el
   * salón no existe («the status code of the response cannot be updated», dice
   * la documentación de streaming de Next). Comprobado: quitando ese
   * `loading.tsx` el 404 sale bien, pero se pierde el esqueleto de carga en la
   * pantalla más visitada del proyecto. Se queda el 200 a sabiendas, porque
   * Next añade `<meta name="robots" content="noindex">` al streamear un 404 y
   * eso es lo que impide que Google lo indexe.
   */
  if (!salon || salon.blocked) notFound();
  const description = `Reserva tu cita en ${salon.name}${salon.address ? ` — ${salon.address}` : ""}. Elige servicio, día y hora en un minuto.`;

  /**
   * En cuanto un salón conecta dominio propio, su web vive en dos sitios a
   * la vez: `sudominio.com/` y `plataforma.com/su-slug`. Para Google eso es
   * contenido duplicado — reparte las señales entre las dos direcciones y
   * decide él cuál enseña, que puede ser justo la que no interesa.
   *
   * El canonical dice cuál manda. Es el dominio del salón siempre que lo
   * tenga: es el que va en el cartel y el que quiere ver un cliente que
   * busca la peluquería por su nombre.
   */
  const canonical = salon.custom_domain
    ? `https://${salon.custom_domain}`
    : `${baseUrl()}/${slug}`;

  return {
    title: `${salon.name} — Reserva tu cita`,
    description,
    alternates: { canonical },
    openGraph: { title: salon.name, description, url: canonical },
    manifest: `/${slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: salon.name, statusBarStyle: "black-translucent" },
    icons: { apple: `/${slug}/pwa-icon?size=180` },
  };
}

export default async function SalonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string; desde?: string }>;
}) {
  const { slug } = await params;
  const { paid, cancelled, desde } = await searchParams;
  const supabase = await supabaseServer();

  // Quien escanea el QR está sentado en la silla: ya conoce el local, ya ha
  // visto los cortes. Enseñarle vídeo ambiental y galería es fricción — y
  // además le cuesta datos. Cabecera compacta y la reserva arriba del todo.
  const enLocal = desde === "local";

  const { data: salon } = await supabase
    .from("salons")
    .select("id, name, slug, phone, address, timezone, logo_url, opens_at, services(*), employees(*)")
    .eq("slug", slug)
    .maybeSingle();

  if (!salon) notFound();

  // Salón bloqueado por el superadmin: su web desaparece.
  const estadoModulos = await estadoSalon(salon.id);
  if (estadoModulos.blocked) notFound();

  const paidBooking = paid ? await confirmPaidSession(slug, paid) : null;

  const services = salon.services.filter((s) => s.active);
  const employees = salon.employees.filter((e) => e.active);

  // Catálogo de productos y features del esquema nuevo. Antes de aplicar
  // las migraciones ambas consultas devuelven vacío y la página se comporta
  // exactamente como hoy.
  const f = await features();
  const productos = f.productos && moduloActivo(estadoModulos, "productos")
    ? ((
        await supabase
          .from("products")
          .select("id, name, description, price_cents")
          .eq("salon_id", salon.id)
          .eq("active", true)
          .order("sort_order")
          .order("name")
      ).data ?? [])
    : [];

  // Si quien mira tiene sesión, su ficha de este salón rellena el formulario.
  // Más allá de ahorrarle escribir, consigue que reserve con el MISMO
  // teléfono con el que ya está fichado: una sola ficha y una sola tarjeta
  // de fidelidad, en vez de un duplicado por cada forma de escribirlo.
  let cliente: { name: string; phone: string; email: string } | null = null;
  let haySesion = false;
  if (f.clientes) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      haySesion = true;
      const { data: ficha } = await supabase
        .from("customers")
        .select("name, phone, email")
        .eq("salon_id", salon.id)
        .eq("auth_user_id", user.id)
        .maybeSingle();
      const c = ficha as { name: string | null; phone: string | null; email: string | null } | null;
      cliente = {
        name: c?.name ?? "",
        phone: c?.phone ?? "",
        email: c?.email ?? user.email ?? "",
      };
    }
  }

  const { data: tramos } = await supabase
    .from("working_hours")
    .select("weekday, start_min, end_min, employees!inner(salon_id, active)")
    .eq("employees.salon_id", salon.id)
    .eq("employees.active", true);
  const listaTramos = (tramos ?? []) as unknown as Tramo[];
  /**
   * Un salón que todavía no ha abierto reparte su enlace antes de abrir —el
   * cartel, el Instagram, el boca a boca empiezan días antes—, así que la
   * web tiene que estar en pie y decir la verdad: ni «abierto ahora» ni «no
   * queda hueco», que es lo que entendería el cliente si solo se bloquearan
   * los huecos.
   *
   * Se compara en la zona del salón, no en UTC: el día 1 empieza cuando
   * amanece allí.
   */
  const hoyLocal = new Intl.DateTimeFormat("sv-SE", {
    timeZone: salon.timezone,
  }).format(new Date());
  const abreEl: string | null =
    salon.opens_at && salon.opens_at > hoyLocal ? salon.opens_at : null;

  const estado = abreEl
    ? {
        abierto: false,
        texto: `Abrimos el ${new Date(`${abreEl}T12:00:00`).toLocaleDateString("es-ES", {
          day: "numeric",
          month: "long",
          timeZone: salon.timezone,
        })}`,
      }
    : listaTramos.length
      ? estadoApertura(listaTramos, salon.timezone)
      : null;

  // Horario público de la semana: la unión de los tramos del equipo. Dos
  // profesionales con el mismo turno no deben pintar la franja dos veces,
  // así que se fusionan los solapes.
  const dowHoy = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    new Intl.DateTimeFormat("en-US", { timeZone: salon.timezone, weekday: "short" }).format(new Date())
  );
  const horarioSemanal = [1, 2, 3, 4, 5, 6, 0]
    .map((dow) => {
      const franjas = listaTramos
        .filter((t) => t.weekday === dow)
        .sort((a, b) => a.start_min - b.start_min)
        .reduce<{ ini: number; fin: number }[]>((acc, t) => {
          const ultimo = acc[acc.length - 1];
          if (ultimo && t.start_min <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.end_min);
          else acc.push({ ini: t.start_min, fin: t.end_min });
          return acc;
        }, []);
      return {
        dia: DIAS[dow],
        esHoy: dow === dowHoy,
        texto: franjas.length
          ? franjas.map((f) => `${hhmm(f.ini)} – ${hhmm(f.fin)}`).join(" · ")
          : "Cerrado",
      };
    })
    .filter((d) => listaTramos.length > 0);

  const fotos = await fotosDelSalon(salon.id);

  const mapa = salon.address
    ? mapaUrl(salon.address)
    : null;

  return (
    <>
    {/* En una visita repetida el service worker ya está activo, así que Chrome
        dispara `beforeinstallprompt` nada más cargar — antes de que hidrate
        InstallPrompt y ponga su listener. El evento no se puede recuperar
        después, así que se aparca aquí, en el HTML, y el componente lo recoge
        al montar. Sin esto el banner sale la primera vez y nunca más.

        El registro del service worker va aquí y no en el useEffect del
        componente por el caso contrario, el de la PRIMERA visita: Chrome
        decide si la web es instalable al cargarla, y si para entonces no hay
        service worker decide que no y no dispara el evento en toda la
        sesión. Registrándolo durante el parseo del HTML llega a tiempo;
        esperando a que hidrate React, no. */}
    <script
      dangerouslySetInnerHTML={{
        __html:
          'addEventListener("beforeinstallprompt",function(e){' +
          "e.preventDefault();window.__bip=e},{once:true});" +
          'if("serviceWorker"in navigator)' +
          'navigator.serviceWorker.register("/sw.js").catch(function(){})',
      }}
    />
    <main className="flex-1 flex flex-col">
      {/* ── Escaparate: portada ambiental con la identidad del salón ── */}
      <header className="relative overflow-hidden">
        {!enLocal && (
          <>
            <VideoFondo
              mp4="/hero-loop.mp4"
              webm="/hero-loop.webm"
              poster="/hero-poster.webp"
              className="solo-escaparate absolute inset-0 h-full w-full object-cover"
            />
            <div
              aria-hidden
              className="solo-escaparate absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, var(--bg) 3%, oklch(0.155 0.012 75 / 0.88) 38%, oklch(0.155 0.012 75 / 0.62) 74%, oklch(0.155 0.012 75 / 0.45))",
              }}
            />
          </>
        )}
        <div
          className={`relative mx-auto w-full max-w-xl px-5 text-center ${
            enLocal ? "pt-8 pb-6" : "pt-14 pb-12"
          }`}
        >
          {/* 112px, no 80: un lettering ornamental con sub-línea y filigrana
              (el caso Paye Villalobos) se vuelve una mancha por debajo de
              ~100px. Los logos simples aguantan de sobra este tamaño. */}
          {salon.logo_url && (
            <span
              className={`plato-logo mx-auto shadow-2xl shadow-black/50 ${
                enLocal ? "mb-4" : "mb-6"
              }`}
            >
              {/* El logo lleva al inicio, como en cualquier web. Importa
                  sobre todo dentro del flujo de reserva: es el gesto que
                  todo el mundo prueba para volver atrás.

                  aria-label porque el alt va vacío —el logo es decorativo
                  junto al nombre— y un enlace sin nombre accesible no lo
                  puede usar quien navega con lector de pantalla. */}
              <LogoInicio
                href={`/${salon.slug}`}
                etiqueta={`Ir al inicio de ${salon.name}`}
                className="block rounded-xl focus-visible:outline-2
                  focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={salon.logo_url}
                  alt=""
                  width={512}
                  height={512}
                  fetchPriority="high"
                  className={`rounded-xl object-contain ${
                    enLocal ? "h-16 w-16" : "h-28 w-28 sm:h-32 sm:w-32"
                  }`}
                />
              </LogoInicio>
            </span>
          )}
          <h1 className="font-display display-l font-semibold text-brand text-balance">
            {salon.name}
          </h1>

          {/* Dirección y teléfono en placa hundida: lo primero que se busca
              al entrar, y en neumorfismo el hueco es lo que dice "dato".
              Desde el local no hace falta la dirección — ya está allí. */}
          {!enLocal && (salon.address || salon.phone) && (
            <div className="solo-escaparate neu-in mt-5 inline-flex flex-col gap-1 rounded-2xl px-5 py-4">
              {salon.address && (
                <a
                  href={mapa ?? undefined}
                  target="_blank"
                  rel="noopener"
                  className="text-sm text-muted hover:text-ink"
                >
                  {salon.address}
                </a>
              )}
              {salon.phone && (
                <a
                  href={telHref(salon.phone)}
                  className="font-display text-xl tabular-nums text-ink hover:text-brand"
                >
                  {salon.phone}
                </a>
              )}
              {estado && (
                <span className="mt-1 inline-flex items-center justify-center gap-2 text-sm" role="status">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${estado.abierto ? "bg-ok" : "bg-muted"}`}
                  />
                  <span className={estado.abierto ? "text-ok" : "text-muted"}>{estado.texto}</span>
                </span>
              )}
            </div>
          )}

          {/* Vía rápida: quien ya conoce el sitio no mira nada más. Desde el
              QR sobra: la reserva ya está justo debajo. */}
          {!enLocal && services.length > 0 && employees.length > 0 && (
            <a
              href="#reservar"
              className="solo-escaparate btn-primary mt-7 h-14 w-full max-w-xs px-10 text-lg"
            >
              Reserva tu cita
            </a>
          )}
          {enLocal && estado && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm" role="status">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${estado.abierto ? "bg-ok" : "bg-muted"}`}
              />
              <span className={estado.abierto ? "text-ok" : "text-muted"}>{estado.texto}</span>
            </p>
          )}
        </div>
      </header>

      {/* ── Los trabajos: la prueba, justo debajo del botón ─────────── */}
      {!enLocal && fotos.length > 0 && (
        <section className="solo-escaparate solapa bg-surface pt-12 pb-14" aria-label="Trabajos">
          <div className="relative mx-auto w-full max-w-xl px-5 mb-6">
            <p className="rotulo mb-4">Nuestros trabajos</p>
            <h2 className="font-display text-2xl font-semibold">Así cortamos</h2>
          </div>
          <Carrusel fotos={fotos} alt={salon.name} />
        </section>
      )}

      {/* ── Zona de tarea: cero efectos, la reserva manda ──────────── */}
      <div id="reservar" className="solapa flex-1 flex flex-col scroll-mt-2">
        <div className="relative mx-auto w-full max-w-xl px-5 pt-12 pb-16 flex-1 flex flex-col">

      {paidBooking && (
        <div className="panel p-6 text-center mb-2" role="status">
          <span className="font-display text-4xl text-ok block" aria-hidden>✓</span>
          <h2 className="mt-3 text-xl font-semibold">Pago recibido, cita confirmada</h2>
          <p className="mt-2 text-muted">
            {paidBooking.serviceName} con {paidBooking.employeeName}
            <br />
            {paidBooking.when}
          </p>
          <p className="mt-3 text-sm text-muted">Te esperamos, {paidBooking.customerName}.</p>
        </div>
      )}
      {paid && !paidBooking && (
        <p className="text-center text-muted mb-2" role="status">
          Estamos confirmando tu pago… si tu cita no aparece confirmada en unos
          minutos, {salon.phone ? `llámanos al ${salon.phone}.` : "contacta con el salón."}
        </p>
      )}
      {cancelled && (
        <p className="text-center text-danger mb-2" role="alert">
          Pago cancelado: la reserva no se ha completado. El hueco quedará libre de nuevo en unos minutos.
        </p>
      )}

      {services.length === 0 || employees.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-lg font-medium">La reserva online aún no está lista</p>
          <p className="mt-2 text-muted">
            {salon.phone
              ? "Llama y te atendemos al momento."
              : "Vuelve a intentarlo en un rato."}
          </p>
          {salon.phone && (
            <a href={telHref(salon.phone)} className="btn-primary mt-6">
              Llamar al {salon.phone}
            </a>
          )}
        </div>
      ) : (
        <BookingWidget
          slug={salon.slug}
          timezone={salon.timezone}
          salonName={salon.name}
          salonPhone={salon.phone}
          services={services}
          employees={employees}
          productos={productos}
          conCuenta={f.clientes}
          cliente={cliente}
          abreEl={abreEl}
          claveVapid={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        />
      )}

        </div>
      </div>


      {/* ── Escaparate: horario de la semana ──────────────────────── */}
      {/* Lleva !enLocal como el resto del escaparate: desde el QR del local
          el horario sobra tanto como la dirección. Antes se colaba. */}
      {!enLocal && horarioSemanal.length > 0 && (
        <section className="solo-escaparate solapa pt-14 pb-16">
          <div className="relative mx-auto w-full max-w-xl px-5">
            <p className="rotulo mb-5">Horario</p>
            <h2 className="font-display text-2xl font-semibold mb-6">Cuándo estamos</h2>
            <dl className="panel divide-y divide-line">
              {horarioSemanal.map((d) => (
                <div
                  key={d.dia}
                  className={`flex items-baseline justify-between gap-4 px-4 py-3 ${
                    d.esHoy ? "bg-brand/5" : ""
                  }`}
                >
                  <dt className={`capitalize ${d.esHoy ? "font-semibold text-brand" : ""}`}>
                    {d.dia}
                    {d.esHoy && <span className="ml-2 text-xs font-normal text-muted">hoy</span>}
                  </dt>
                  <dd className="tabular-nums text-right text-sm text-muted">{d.texto}</dd>
                </div>
              ))}
            </dl>
            {mapa && (
              <a
                href={mapa}
                target="_blank"
                rel="noopener"
                className="btn-quiet mt-6 w-full"
              >
                Cómo llegar ↗
              </a>
            )}
          </div>
        </section>
      )}

      <footer className="bg-bg py-10 text-center text-xs text-muted flex flex-col items-center gap-3">
        {/* Acceso discreto para quien ya es cliente: magic link en /perfil.
            Solo aparece con la función "clientes" encendida (migración 0006),
            para no ofrecer un login que aún no guarda nada. La cita en sí no
            necesita cuenta: vive en el enlace /cita/[token] del email. */}
        {/* Con sesión abierta el texto cambia: seguir ofreciendo "entra a tu
            cuenta" a quien ya entró era la única señal de sesión en toda la
            web pública, y decía lo contrario de la verdad. */}
        {f.clientes && (
          <Link
            href={`/${salon.slug}/perfil`}
            className="text-sm text-muted transition-[color,transform] duration-150
              active:scale-95 hover:text-brand"
          >
            {haySesion ? (
              <span className="text-brand underline underline-offset-4">Mi cuenta</span>
            ) : (
              <>
                ¿Ya eres cliente?{" "}
                <span className="text-brand underline underline-offset-4">Entra a tu cuenta</span>
              </>
            )}
            <LinkCargando />
          </Link>
        )}
        {/* La nota de privacidad es del salón, no de la plataforma: quien
            reserva le da sus datos a la peluquería. El RGPD pide que esté a
            mano en el momento de recogerlos, y este pie es la única parte
            que se ve desde cualquier punto de la página. */}
        <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>Reservas por Salonio</span>
          <span aria-hidden className="opacity-40">·</span>
          <Link
            href={`/${salon.slug}/privacidad`}
            className="underline underline-offset-4 transition-[color,transform] duration-150
              active:scale-95 hover:text-brand"
          >
            Privacidad
            <LinkCargando />
          </Link>
        </span>
      </footer>
    </main>
    {/* Fuera de <main>: es position:fixed, y cualquier transform/filter en
        un ancestro lo convertiría en su containing block — dejaría de
        estar fijo al viewport y se iría con el scroll. */}
    <InstallPrompt slug={salon.slug} salonName={salon.name} logoUrl={salon.logo_url} />
    {/* Solo se pinta en standalone. Nunca coincide con InstallPrompt, que se
        oculta precisamente cuando la app ya está instalada. */}
    <BarraInferior slug={salon.slug} />
    <ModoReserva />
    </>
  );
}

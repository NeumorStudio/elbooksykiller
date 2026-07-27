import type { Metadata } from "next";
import Link from "next/link";
import VideoFondo from "./video-fondo";
import { OPERADOR } from "@/lib/legal";

// El alta ya no es automática, así que los CTA llevan a hablar con nosotros.
// Mismo contacto que el aviso legal: uno solo que mantener. Sin LEGAL_EMAIL no
// se pinta un mailto roto — al aviso legal, que es donde está el contacto.
const CONTACTO = OPERADOR.email ? `mailto:${OPERADOR.email}` : "/legal";

/**
 * El escaparate de Salonio no se indexa mientras la plataforma no sea un
 * negocio en marcha.
 *
 * Es una página de venta —precio, «Pide tu alta», captación— y el plan
 * Hobby de Vercel está limitado a uso personal no comercial: «advertising
 * the sale of a product or service» es uno de sus ejemplos textuales. Las
 * webs de los salones no cambian, siguen indexándose; lo que se quita del
 * mapa es la tienda de la propia plataforma.
 *
 * Para encenderla el día que se cobre —y se pase a Pro—: PLATAFORMA_INDEXABLE=1.
 */
export function generateMetadata(): Metadata {
  return {
    title: "Salonio — tu peluquería, con su propia web de reservas",
    description:
      "Web de reservas propia para peluquerías y barberías. Sin comisiones por cita, sin marketplace delante de tu marca. Tus clientes reservan solos en un minuto.",
    robots:
      process.env.PLATAFORMA_INDEXABLE === "1"
        ? undefined
        : { index: false, follow: false },
  };
}

const PASOS = [
  {
    n: "01",
    titulo: "Tu web, con tu marca",
    texto:
      "Tu logo, tu nombre y tu dirección — sin anuncios de otros salones al lado. Instalable como app en el móvil del cliente, y con tu dominio propio si lo tienes.",
    detalle: "tuweb.com/tu-salon · o tudominio.com",
  },
  {
    n: "02",
    titulo: "La agenda se lleva sola",
    texto:
      "Tus clientes ven los huecos reales de cada profesional y confirman en menos de un minuto, sin registrarse. Tú lo ves todo en tu panel: quién viene, cuándo y con quién.",
    detalle: "Horarios por profesional · vacaciones · sin dobles reservas",
  },
  {
    n: "03",
    titulo: "Cobra si quieres",
    texto:
      "Señal o pago completo al reservar, directo a tu banco con Stripe. Sin comisiones por cita: lo que cobras es tuyo. Y si prefieres cobrar en el local, no actives nada.",
    detalle: "Opcional por servicio · el dinero no pasa por nosotros",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      {/* ── Hero ────────────────────────────────────────────────
          El póster es el LCP y está visible desde el primer frame; el
          vídeo entra después, cuando ya no compite por ancho de banda. */}
      <section className="relative min-h-[100svh] flex items-end overflow-hidden hero-cede">
        <VideoFondo
          mp4="/hero-loop.mp4"
          webm="/hero-loop.webm"
          poster="/hero-poster.webp"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Velo direccional, no plano: preserva la profundidad de la escena
            y garantiza el contraste del texto contra el frame más claro. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, oklch(0.155 0.012 75) 4%, oklch(0.155 0.012 75 / 0.86) 34%, oklch(0.155 0.012 75 / 0.5) 68%, oklch(0.155 0.012 75 / 0.35))",
          }}
        />

        <div className="relative mx-auto w-full max-w-5xl px-6 pb-20 sm:pb-28">
          <p className="rotulo mb-6 max-w-xs">Reservas para peluquerías</p>
          <h1 className="font-display display-xl font-semibold text-brand max-w-4xl text-balance">
            Tu peluquería,
            <br />
            con su propia web
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-muted max-w-md text-pretty">
            Tus clientes reservan solos, tú dejas de coger el teléfono. Sin
            comisiones por cita, sin marketplace delante de tu marca.
          </p>
          {/* El CTA nunca sobre el vídeo: fondo sólido, contraste garantizado */}
          <div className="flex flex-wrap gap-3 mt-9">
            <a href={CONTACTO} className="btn-primary px-8 text-base">
              Pide tu alta
            </a>
            <Link href="/admin/login" className="btn-quiet px-8 text-base bg-bg/70">
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ───────────────────────────────────────
          .solapa monta esta sección sobre el hero: deja de ser un bloque
          apilado y pasa a ser una superficie continua. */}
      <section className="solapa pt-16 sm:pt-24 pb-20 sm:pb-28">
        <div className="relative mx-auto max-w-2xl px-6">
          <p className="rotulo mb-5">Cómo funciona</p>
          <h2 className="font-display display-l font-semibold text-balance">
            Todo lo que necesita tu salón, nada más
          </h2>

          <div className="pila mt-14 flex flex-col gap-6">
            {PASOS.map((p) => (
              <article
                key={p.n}
                className="panel p-7 sm:p-9 shadow-2xl shadow-black/40 relative overflow-hidden"
              >
                <span
                  aria-hidden
                  className="absolute -top-4 -right-2 font-display text-[7rem] leading-none text-brand/[0.07] select-none tabular-nums"
                >
                  {p.n}
                </span>
                <p className="relative font-display text-2xl text-brand tabular-nums">{p.n}</p>
                <h3 className="relative mt-2 text-xl sm:text-2xl font-semibold">{p.titulo}</h3>
                <p className="relative mt-4 text-muted text-pretty">{p.texto}</p>
                <p className="relative mt-6 pt-4 border-t border-line text-sm text-brand/90">
                  {p.detalle}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cierre ──────────────────────────────────────────────── */}
      <section className="solapa pt-16 sm:pt-20 pb-20 sm:pb-24">
        <div className="relative mx-auto max-w-2xl px-6 text-center flex flex-col items-center gap-6">
          <h2 className="font-display display-l font-semibold text-balance revelar">
            Deja de coger el teléfono a mitad de un corte
          </h2>
          <p className="text-muted max-w-md text-pretty revelar">
            Damos de alta las peluquerías una a una para acompañar la puesta en
            marcha. Escríbenos y te montamos la tuya: la dejamos lista y los
            primeros pasos se pueden configurar por voz.
          </p>
          <a href={CONTACTO} className="btn-primary px-8 text-base revelar">
            Pide tu alta
          </a>
        </div>
      </section>

      <footer className="border-t border-line bg-bg">
        <div className="mx-auto max-w-5xl px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span className="flex items-center gap-2 font-display text-base text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/salonio.svg" alt="" width={18} height={36} className="h-9 w-auto" />
            Salonio
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Sin comisiones por cita · Sin permanencia</span>
            <span aria-hidden className="opacity-40">·</span>
            <Link href="/legal" className="underline underline-offset-4 hover:text-brand">
              Aviso legal y privacidad
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}

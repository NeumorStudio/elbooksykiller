import Link from "next/link";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { domainStatus } from "@/lib/vercel";
import QRCode from "qrcode";
import {
  guardarGoogleUrl,
  setCustomDomain,
  removeCustomDomain,
  uploadLogo,
  removeLogo,
  uploadFotos,
  removeFoto,
} from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";
import { supabaseAdmin } from "@/lib/supabase/server";
import { features } from "@/lib/features";
import Ayuda from "../ayuda";

export default async function WebsitePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const f = await features();
  // La select dinámica (google_review_url solo existe tras la migración
  // 0010) rompe la inferencia de supabase-js: se tipa la fila a mano.
  const { data: salonRaw } = await supabase
    .from("salons")
    .select("id, slug, custom_domain, logo_url" + (f.resenas ? ", google_review_url" : ""))
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();
  const salon = salonRaw as unknown as {
    id: string;
    slug: string;
    custom_domain: string | null;
    logo_url: string | null;
    google_review_url?: string | null;
  } | null;

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const admin = supabaseAdmin();
  const carpeta = `galeria/${salon.id}`;
  const { data: ficheros } = await admin.storage
    .from("logos")
    .list(carpeta, { limit: 60, sortBy: { column: "name", order: "asc" } });
  const fotos = (ficheros ?? [])
    .filter((f) => f.id)
    .map((f) => ({
      nombre: f.name,
      url: admin.storage.from("logos").getPublicUrl(`${carpeta}/${f.name}`).data.publicUrl,
    }));

  const h = await headers();
  const platformUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/${salon.slug}`;

  const status = salon.custom_domain ? await domainStatus(salon.custom_domain) : null;
  const isApex = salon.custom_domain ? salon.custom_domain.split(".").length === 2 : false;

  const bookingUrl = salon.custom_domain && status?.configured
    ? `https://${salon.custom_domain}`
    : platformUrl;
  const qrSvg = await QRCode.toString(bookingUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1b1712", light: "#ffffff" },
  });

  return (
    <main className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div>
        <span className="flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-semibold">Mi web</h1>
          <Ayuda titulo="Mi web">
            <p>
              Tu web de reservas ya existe y funciona — aquí la vistes y la
              repartes.
            </p>
            <p>
              <b>Comparte tu dirección</b> donde ya hablas con tus clientes:
              estado de WhatsApp, bio de Instagram, Google Maps. Es el enlace
              de arriba.
            </p>
            <p>
              <b>El código QR</b> es para el local: imprime el cartel y ponlo
              en el mostrador o el escaparate. Quien lo escanea con la cámara
              cae directo en tu web para reservar.
            </p>
            <p>
              <b>Logo y fotos</b> son tu escaparate digital. Las fotos de tus
              trabajos son lo que más convence a quien no te conoce — sube
              tus mejores cortes.
            </p>
            <p>
              <b>Reseñas de Google:</b> si pegas el enlace de tu ficha,
              después de cada visita se invita al cliente a dejarte reseña.
            </p>
            <p>
              <b>Dominio propio</b> es opcional: si compraste
              «tupeluqueria.com», tu web puede vivir ahí. Sin dominio, tu
              dirección de la plataforma funciona igual de bien.
            </p>
          </Ayuda>
        </span>
        <p className="text-muted mt-1">La dirección donde tus clientes reservan.</p>
      </div>

      <div className="panel p-6">
        <p className="text-sm text-muted">Tu dirección en la plataforma (siempre activa)</p>
        <p className="mt-1 font-medium break-all">
          <Link href={`/${salon.slug}`} target="_blank" className="underline underline-offset-4">
            {platformUrl} ↗
          </Link>
        </p>
      </div>

      <div className="panel p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Código QR para tu local</h2>
          <p className="text-sm text-muted mt-1 text-pretty">
            Imprímelo y ponlo en el mostrador o el escaparate: tus clientes lo
            escanean, reservan, y pueden instalarse tu web como app.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <div
            className="w-36 h-36 rounded-lg overflow-hidden bg-white p-1.5 shrink-0 [&_svg]:w-full [&_svg]:h-full"
            role="img"
            aria-label={`Código QR de ${bookingUrl}`}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="flex flex-col gap-2">
            <a href="/admin/poster" target="_blank" className="btn-primary text-sm">
              Cartel para imprimir
            </a>
            <a href="/admin/qr" className="btn-quiet text-sm" download>
              Descargar QR (PNG)
            </a>
          </div>
        </div>
      </div>

      <div className="panel p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Logo</h2>
          <p className="text-sm text-muted mt-1 text-pretty">
            Aparece en la cabecera de tu web y como icono cuando tus clientes
            la instalan en el móvil. PNG, JPG o WebP, máx. 2 MB.
          </p>
        </div>
        {salon.logo_url && (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={salon.logo_url}
              alt="Logo actual"
              className="h-16 w-16 rounded-xl object-contain bg-surface-2 border border-line p-1"
            />
            <form action={removeLogo}>
              <ConfirmSubmit message="¿Quitar el logo? Volverá a mostrarse solo el nombre del salón.">
                Quitar
              </ConfirmSubmit>
            </form>
          </div>
        )}
        <ActionForm action={uploadLogo} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-56">
            <label htmlFor="logo" className="label">
              {salon.logo_url ? "Cambiar logo" : "Subir logo"}
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              className="field pt-2"
            />
          </div>
          <SubmitButton className="btn-primary" pendingText="Subiendo…">Guardar logo</SubmitButton>
        </ActionForm>
      </div>

      <div className="panel p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Fotos de tus trabajos</h2>
          <p className="text-sm text-muted mt-1 text-pretty">
            Es lo primero que ve quien no te conoce, y lo que más convence.
            Salen en tu web justo debajo del nombre. Si las tienes en
            Instagram, descárgalas y súbelas aquí. PNG, JPG o WebP, máx. 3 MB
            cada una.
          </p>
        </div>

        {fotos.length > 0 && (
          <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {fotos.map((f) => (
              <li key={f.nombre} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.url}
                  alt=""
                  loading="lazy"
                  className="aspect-[3/4] w-full rounded-lg border border-line object-cover"
                />
                <form action={removeFoto} className="absolute top-1 right-1">
                  <input type="hidden" name="nombre" value={f.nombre} />
                  <ConfirmSubmit
                    className="btn-quiet h-8 min-h-8 w-8 rounded-full border-0 bg-bg/85 px-0 text-sm text-ink"
                    message="¿Quitar esta foto de tu web?"
                  >
                    ×
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}

        <ActionForm action={uploadFotos} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-56">
            <label htmlFor="fotos" className="label">
              {fotos.length ? "Añadir más fotos" : "Subir fotos"}
            </label>
            <input
              id="fotos"
              name="fotos"
              type="file"
              required
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="field pt-2"
            />
            <p className="text-xs text-muted mt-1.5">
              Puedes seleccionar varias a la vez (máx. 12 por tanda).
            </p>
          </div>
          <SubmitButton className="btn-primary" pendingText="Subiendo…">
            Guardar fotos
          </SubmitButton>
        </ActionForm>
      </div>

      {f.resenas && (
        <ActionForm action={guardarGoogleUrl} className="panel p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Reseñas de Google</h2>
            <p className="text-sm text-muted mt-1 text-pretty">
              Tras cada visita pedimos una valoración privada, y después
              ofrecemos tu ficha de Google a todo el mundo por igual. Pega
              aquí el enlace de tu ficha.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-56">
              <label htmlFor="gr-url" className="label">Enlace de tu ficha</label>
              <input
                id="gr-url"
                name="google_review_url"
                type="url"
                placeholder="https://g.page/r/..."
                defaultValue={salon.google_review_url ?? ""}
                className="field"
              />
            </div>
            <SubmitButton className="btn-primary" pendingText="Guardando…">
              Guardar
            </SubmitButton>
          </div>
        </ActionForm>
      )}

      <div className="panel p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Dominio propio</h2>
          <p className="text-sm text-muted mt-1 text-pretty">
            Si tienes un dominio (ej. <b>barberiapaco.com</b>), tu web de reservas
            puede vivir ahí. El certificado SSL se genera solo.
          </p>
        </div>

        {salon.custom_domain ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium break-all">{salon.custom_domain}</span>
              {status?.configured ? (
                <span className="text-sm text-ok font-medium">✓ Activo</span>
              ) : (
                <span className="text-sm text-muted">Esperando DNS…</span>
              )}
              <form action={removeCustomDomain} className="ml-auto">
                <ConfirmSubmit message={`¿Desconectar ${salon.custom_domain}? Tu web seguirá activa en la dirección de la plataforma.`}>
                  Quitar
                </ConfirmSubmit>
              </form>
            </div>

            {!status?.configured && (
              <div className="rounded-lg bg-surface-2 p-4 text-sm flex flex-col gap-2">
                <p className="font-medium">Configura esto donde compraste el dominio:</p>
                {isApex ? (
                  <p>
                    Registro <b>A</b> · Nombre: <b>@</b> · Valor:{" "}
                    <code className="font-mono">76.76.21.21</code>
                  </p>
                ) : (
                  <p>
                    Registro <b>CNAME</b> · Nombre:{" "}
                    <b>{salon.custom_domain.split(".")[0]}</b> · Valor:{" "}
                    <code className="font-mono">cname.vercel-dns.com</code>
                  </p>
                )}
                {status?.verification?.map((v) => (
                  <p key={v.value}>
                    Además, registro <b>{v.type}</b> en <b>{v.domain}</b> con valor:{" "}
                    <code className="font-mono break-all">{v.value}</code>
                  </p>
                ))}
                <p className="text-muted">
                  Los cambios de DNS pueden tardar desde minutos hasta unas horas.
                  Recarga esta página para comprobar el estado.
                </p>
              </div>
            )}
          </>
        ) : (
          <ActionForm action={setCustomDomain} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-56">
              <label htmlFor="domain" className="label">Dominio</label>
              <input
                id="domain"
                name="domain"
                required
                placeholder="www.barberiapaco.com"
                className="field"
              />
            </div>
            <SubmitButton className="btn-primary" pendingText="Conectando…">Conectar dominio</SubmitButton>
          </ActionForm>
        )}
      </div>
    </main>
  );
}

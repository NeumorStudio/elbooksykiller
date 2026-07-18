import Link from "next/link";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { domainStatus } from "@/lib/vercel";
import { setCustomDomain, removeCustomDomain, uploadLogo, removeLogo } from "../actions";
import SubmitButton from "../submit-button";
import ActionForm from "../action-form";
import ConfirmSubmit from "../confirm-submit";

export default async function WebsitePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: salon } = await supabase
    .from("salons")
    .select("slug, custom_domain, logo_url")
    .eq("owner_id", user!.id)
    .limit(1)
    .maybeSingle();

  if (!salon) return <p className="text-muted">Primero crea tu peluquería en la Agenda.</p>;

  const h = await headers();
  const platformUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/${salon.slug}`;

  const status = salon.custom_domain ? await domainStatus(salon.custom_domain) : null;
  const isApex = salon.custom_domain ? salon.custom_domain.split(".").length === 2 : false;

  return (
    <main className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-semibold">Mi web</h1>
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
          <h2 className="font-semibold">Logo</h2>
          <p className="text-sm text-muted mt-1 text-pretty">
            Aparece en la cabecera de tu web y como icono cuando tus clientes
            la instalan en el móvil. PNG, JPG, WebP o SVG, máx. 2 MB.
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
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="field pt-2"
            />
          </div>
          <SubmitButton className="btn-primary" pendingText="Subiendo…">Guardar logo</SubmitButton>
        </ActionForm>
      </div>

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

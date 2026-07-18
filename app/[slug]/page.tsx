import { supabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import BookingWidget from "./booking-widget";
import InstallPrompt from "./install-prompt";
import { confirmPaidSession } from "./actions";

export const viewport = { themeColor: "#1b1712" };

// La pestaña y el preview de WhatsApp muestran el salón, no la plataforma
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("name, address")
    .eq("slug", slug)
    .maybeSingle();
  if (!salon) return {};
  const description = `Reserva tu cita en ${salon.name}${salon.address ? ` — ${salon.address}` : ""}. Elige servicio, día y hora en un minuto.`;
  return {
    title: `${salon.name} — Reserva tu cita`,
    description,
    openGraph: { title: salon.name, description },
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
  searchParams: Promise<{ paid?: string; cancelled?: string }>;
}) {
  const { slug } = await params;
  const { paid, cancelled } = await searchParams;
  const supabase = await supabaseServer();

  const { data: salon } = await supabase
    .from("salons")
    .select("id, name, slug, phone, address, timezone, services(*), employees(*)")
    .eq("slug", slug)
    .maybeSingle();

  if (!salon) notFound();

  const paidBooking = paid ? await confirmPaidSession(slug, paid) : null;

  const services = salon.services.filter((s) => s.active);
  const employees = salon.employees.filter((e) => e.active);

  return (
    <main className="mx-auto w-full max-w-xl px-5 pb-24">
      <header className="pt-14 pb-10 text-center">
        <p className="text-sm text-muted mb-3">Reserva tu cita en</p>
        <h1
          className="font-display text-5xl sm:text-6xl font-semibold text-brand"
          style={{ letterSpacing: "-0.02em" }}
        >
          {salon.name}
        </h1>
        {(salon.address || salon.phone) && (
          <p className="mt-4 text-muted">
            {salon.address}
            {salon.address && salon.phone && " · "}
            {salon.phone && (
              <a href={`tel:${salon.phone}`} className="underline underline-offset-4 hover:text-ink">
                {salon.phone}
              </a>
            )}
          </p>
        )}
      </header>

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
            <a href={`tel:${salon.phone}`} className="btn-primary mt-6">
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
        />
      )}

      <footer className="mt-16 text-center text-xs text-muted">
        Reservas por ElBooksyKiller
      </footer>

      <InstallPrompt slug={salon.slug} salonName={salon.name} />
    </main>
  );
}

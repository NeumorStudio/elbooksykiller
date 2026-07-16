import { supabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import BookingWidget from "./booking-widget";

export default async function SalonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();

  const { data: salon } = await supabase
    .from("salons")
    .select("id, name, slug, phone, address, timezone, services(*), employees(*)")
    .eq("slug", slug)
    .maybeSingle();

  if (!salon) notFound();

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
          timezone={salon.timezone}
          salonName={salon.name}
          salonPhone={salon.phone}
          services={services}
          employees={employees}
        />
      )}

      <footer className="mt-16 text-center text-xs text-muted/70">
        Reservas por ElBooksyKiller
      </footer>
    </main>
  );
}

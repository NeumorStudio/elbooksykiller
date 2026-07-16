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
    <main className="max-w-lg mx-auto p-6 flex flex-col gap-8">
      <header className="text-center pt-8">
        <h1 className="text-3xl font-bold">{salon.name}</h1>
        {salon.address && <p className="text-gray-500 mt-1">{salon.address}</p>}
        {salon.phone && <p className="text-gray-500">{salon.phone}</p>}
      </header>

      {services.length === 0 || employees.length === 0 ? (
        <p className="text-center text-gray-500">
          Este salón aún no tiene la reserva online configurada. Llama por teléfono.
        </p>
      ) : (
        <BookingWidget
          timezone={salon.timezone}
          services={services}
          employees={employees}
        />
      )}
    </main>
  );
}

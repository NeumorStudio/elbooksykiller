import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-8 px-6 py-20 text-center">
      <h1
        className="font-display text-5xl sm:text-7xl font-semibold text-brand max-w-3xl"
        style={{ letterSpacing: "-0.02em" }}
      >
        Tu peluquería, con su propia web de reservas
      </h1>
      <p className="text-lg text-muted max-w-md text-pretty">
        Tus clientes reservan solos, tú dejas de coger el teléfono.
        Sin comisiones por cita, sin marketplace delante de tu marca.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/admin" className="btn-primary px-8 text-base">
          Empieza gratis
        </Link>
        <Link href="/admin/login" className="btn-quiet px-8 text-base">
          Ya tengo cuenta
        </Link>
      </div>
    </main>
  );
}

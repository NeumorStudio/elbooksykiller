import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">ElBooksyKiller</h1>
      <p className="text-lg text-gray-500 max-w-md">
        Tu peluquería con web propia y reservas online. Sin comisiones por cita.
      </p>
      <Link
        href="/admin"
        className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-6 py-3 font-medium"
      >
        Panel de administración
      </Link>
    </main>
  );
}

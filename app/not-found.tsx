import Link from "next/link";

// 404 propio: el de Next sale en inglés, sin marca y sin salida. Lo ve
// sobre todo quien escribe mal el slug de un salón.
export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/vacio-404.webp"
        alt=""
        width={640}
        height={640}
        className="h-40 w-40 object-contain opacity-90"
        // lighten: el fondo casi-negro del PNG desaparece contra --bg y
        // solo queda el trazo dorado, sin cuadrado visible.
        style={{ mixBlendMode: "lighten" }}
      />
      <h1 className="font-display text-4xl font-semibold text-brand">
        Aquí no hay nadie sentado
      </h1>
      <p className="text-muted max-w-sm text-pretty">
        Esta dirección no existe o el salón ya no está. Revisa el enlace que te
        han pasado — suele ser una letra de más.
      </p>
      <Link href="/" className="btn-quiet mt-2">
        Ir al inicio
      </Link>
    </main>
  );
}

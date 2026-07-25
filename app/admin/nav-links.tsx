"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Lo diario a la vista, el resto bajo «Más»: la Agenda se abre veinte veces
// al día y Cobros una vez al mes — no merecen el mismo sitio en la barra.
// Los módulos nuevos caen en «Más» sin que la barra crezca ni haga scroll.
// La tarjeta de fidelidad vive dentro de Clientes; las reseñas, en Mi web.
const PRIMARIOS = [
  ["/admin", "Agenda"],
  ["/admin/clientes", "Clientes"],
  ["/admin/services", "Servicios"],
] as const;

const SECUNDARIOS = [
  ["/admin/employees", "Equipo"],
  ["/admin/productos", "Productos"],
  ["/admin/newsletter", "Newsletter"],
  ["/admin/payments", "Cobros"],
  ["/admin/stats", "Estadísticas"],
  ["/admin/website", "Mi web"],
] as const;

export default function NavLinks({ ocultos = [] }: { ocultos?: string[] }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const zona = useRef<HTMLDivElement>(null);

  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!zona.current?.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const clase = (activo: boolean) =>
    `px-2 sm:px-3 min-h-11 inline-flex items-center rounded-lg text-sm font-medium transition-colors duration-150
     ${activo ? "bg-surface text-brand" : "hover:bg-surface"}`;

  const secundarios = SECUNDARIOS.filter(([href]) => !ocultos.includes(href));
  const dentroDeMas = secundarios.some(([href]) => pathname === href);

  return (
    <>
      {PRIMARIOS.filter(([href]) => !ocultos.includes(href)).map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={clase(pathname === href)}
        >
          {label}
        </Link>
      ))}
      {secundarios.length > 0 && (
        <div ref={zona} className="relative flex">
          <button
            type="button"
            aria-expanded={abierto}
            aria-haspopup="menu"
            onClick={() => setAbierto((a) => !a)}
            className={`${clase(dentroDeMas)} gap-1`}
          >
            Más
            <span
              aria-hidden
              className={`text-[0.65rem] transition-transform duration-150 ${abierto ? "rotate-180" : ""}`}
            >
              ▼
            </span>
          </button>
          {abierto && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1.5 flex min-w-44 flex-col rounded-xl
                border border-line bg-bg p-1.5 shadow-xl shadow-black/40"
            >
              {secundarios.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  aria-current={pathname === href ? "page" : undefined}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium
                    ${pathname === href ? "bg-surface text-brand" : "hover:bg-surface"}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

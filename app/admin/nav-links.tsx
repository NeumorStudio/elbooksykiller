"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// El menú del dueño. Clientes/Productos/Newsletter siempre están visibles
// para que sepa que existen; si la función aún no está encendida (falta la
// migración), su pantalla enseña un "muy pronto" en vez de datos. La tarjeta
// de fidelidad vive dentro de Clientes; las reseñas, dentro de Mi web.
const LINKS = [
  ["/admin", "Agenda"],
  ["/admin/services", "Servicios"],
  ["/admin/employees", "Equipo"],
  ["/admin/clientes", "Clientes"],
  ["/admin/productos", "Productos"],
  ["/admin/newsletter", "Newsletter"],
  ["/admin/payments", "Cobros"],
  ["/admin/stats", "Estadísticas"],
  ["/admin/website", "Mi web"],
] as const;

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(([href, label]) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`px-3 min-h-11 inline-flex items-center rounded-lg text-sm font-medium transition-colors duration-150
              ${current ? "bg-surface text-brand" : "hover:bg-surface"}`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}

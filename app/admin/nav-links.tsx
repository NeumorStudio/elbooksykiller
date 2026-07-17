"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/admin", "Agenda"],
  ["/admin/services", "Servicios"],
  ["/admin/employees", "Equipo"],
  ["/admin/payments", "Cobros"],
  ["/admin/stats", "Estadísticas"],
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
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150
              ${current ? "bg-surface text-brand" : "hover:bg-surface"}`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}

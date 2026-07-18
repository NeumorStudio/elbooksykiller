"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/admin", "Agenda"],
  ["/admin/services", "Servicios"],
  ["/admin/employees", "Equipo"],
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

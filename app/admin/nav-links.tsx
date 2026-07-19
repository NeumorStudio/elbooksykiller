"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type FeaturesNav = {
  clientes: boolean;
  productos: boolean;
  newsletter: boolean;
};

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

// Secciones que solo existen con su migración aplicada: hasta entonces no
// aparecen en la nav. Sin `features` (llamada vieja) se comportan igual que
// antes: ocultas.
const CON_FEATURE: Record<string, keyof FeaturesNav> = {
  "/admin/clientes": "clientes",
  "/admin/productos": "productos",
  "/admin/newsletter": "newsletter",
};

export default function NavLinks({ features }: { features?: FeaturesNav }) {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(([href, label]) => {
        const req = CON_FEATURE[href];
        if (req && !features?.[req]) return null;
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

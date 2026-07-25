import type { Metadata } from "next";
import Link from "next/link";
import { OPERADOR, SUBENCARGADOS, dato } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Aviso legal y privacidad — Salonio",
  description:
    "Quién opera Salonio, cómo se tratan los datos de los salones y qué cookies se usan.",
};

/**
 * Lo legal de la plataforma, dirigido a los dueños de salón.
 *
 * Va aparte de /[slug]/privacidad a propósito: ahí Salonio es encargado y el
 * responsable es el salón; aquí Salonio es responsable de los datos de sus
 * propios clientes —los peluqueros que abren cuenta—. Son dos relaciones
 * distintas y mezclarlas en un documento deja las dos mal explicadas.
 */
export default function LegalPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14 flex flex-col gap-10">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Volver
        </Link>
        <h1 className="font-display text-3xl font-semibold mt-4">
          Aviso legal y privacidad
        </h1>
        <p className="text-muted mt-2 text-pretty">
          Esta página habla de Salonio como plataforma. Si eres cliente de una
          peluquería y quieres saber qué hace con tus datos, esa información
          está en la web de tu salón.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Titular</h2>
        <ul className="flex flex-col gap-1">
          <li>
            <span className="text-muted">Denominación:</span>{" "}
            <b>{dato(OPERADOR.titular)}</b>
          </li>
          <li>
            <span className="text-muted">NIF:</span> {dato(OPERADOR.nif)}
          </li>
          <li>
            <span className="text-muted">Domicilio:</span>{" "}
            {dato(OPERADOR.domicilio)}
          </li>
          <li>
            <span className="text-muted">Contacto:</span>{" "}
            {OPERADOR.email ? (
              <a href={`mailto:${OPERADOR.email}`} className="underline hover:text-brand">
                {OPERADOR.email}
              </a>
            ) : (
              dato(null)
            )}
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Qué es este servicio</h2>
        <p className="text-pretty">
          Salonio da a cada peluquería una web propia donde sus clientes
          reservan cita. Salonio no es parte del contrato entre el salón y su
          cliente: no presta el servicio de peluquería, no cobra comisión por
          cita y no interviene en lo que se acuerde entre ambos.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">Datos de los salones</h2>
        <p className="text-pretty">
          De quien abre cuenta se guardan el email, el nombre del salón y los
          datos que decida publicar en su web —dirección, teléfono, logo,
          servicios y precios—. Se usan para prestar el servicio y para
          avisarle de cosas que le afectan. Base legal: la ejecución del
          contrato.
        </p>
        <p className="text-pretty">
          Cualquier salón puede pedir acceder a sus datos, corregirlos o
          borrarlos escribiendo a{" "}
          {OPERADOR.email ? (
            <a href={`mailto:${OPERADOR.email}`} className="underline hover:text-brand">
              {OPERADOR.email}
            </a>
          ) : (
            dato(null)
          )}
          , y reclamar ante la{" "}
          <a
            href="https://www.aepd.es"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-brand"
          >
            Agencia Española de Protección de Datos
          </a>{" "}
          si no queda conforme.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">
          Datos de los clientes de cada salón
        </h2>
        <p className="text-pretty">
          De los datos de las personas que reservan responde{" "}
          <b>el salón</b>, no Salonio. Salonio los trata como{" "}
          <b>encargado del tratamiento</b>: solo siguiendo las instrucciones
          del salón, sin usarlos para fines propios, sin cederlos a nadie y con
          obligación de devolverlos o borrarlos cuando el salón deje de usar el
          servicio.
        </p>
        <p className="text-muted text-sm text-pretty">
          Estas condiciones hacen las veces del acuerdo del art. 28 del RGPD
          entre el salón y Salonio.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Proveedores</h2>
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          {SUBENCARGADOS.map((s) => (
            <li key={s.nombre}>
              <b className="text-ink">{s.nombre}</b> — {s.para} ({s.donde})
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Cookies</h2>
        <p className="text-pretty">
          No hay analítica, ni publicidad, ni rastreadores de terceros. Las
          únicas cookies son las de sesión, que mantienen abierta la cuenta de
          quien entra en el panel. Al ser estrictamente necesarias para prestar
          el servicio, el art. 22.2 de la LSSI-CE no exige consentimiento
          previo — por eso no verás un banner pidiéndotelo.
        </p>
      </section>
    </main>
  );
}

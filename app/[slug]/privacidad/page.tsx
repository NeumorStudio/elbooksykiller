import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { OPERADOR, SUBENCARGADOS, dato } from "@/lib/legal";

/**
 * Información de protección de datos de UN salón, no de la plataforma.
 *
 * El responsable del tratamiento es el salón: es él quien decide para qué
 * quiere los datos de sus clientes. Salonio es encargado — pone la
 * herramienta y trata los datos por cuenta del salón. Confundirlo es el
 * error típico de las plataformas multi-cliente, y deja al salón sin la
 * información del art. 13 del RGPD que tiene obligación de dar.
 *
 * Por eso los datos del responsable salen de la ficha del salón y no de una
 * constante: cada salón enseña los suyos.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();
  if (!salon) return {};
  return {
    title: `Privacidad — ${salon.name}`,
    description: `Cómo trata ${salon.name} los datos de sus clientes.`,
  };
}

export default async function PrivacidadSalon({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const { data: salon } = await supabase
    .from("salons")
    .select("name, address, phone")
    .eq("slug", slug)
    .maybeSingle();

  if (!salon) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14 flex flex-col gap-8">
      <div>
        <Link href={`/${slug}`} className="text-sm text-muted hover:text-ink">
          ← Volver a {salon.name}
        </Link>
        <h1 className="font-display text-3xl font-semibold mt-4">
          Protección de datos
        </h1>
        <p className="text-muted mt-2 text-pretty">
          Qué datos te pedimos al reservar, para qué los usamos y cómo puedes
          quitarlos cuando quieras.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Quién responde de tus datos</h2>
        <p className="text-pretty">
          El responsable es <b>{salon.name}</b>
          {salon.address && <>, con establecimiento en {salon.address}</>}
          {salon.phone && (
            <>
              . Puedes contactar en el teléfono <b>{salon.phone}</b>
            </>
          )}
          .
        </p>
        <p className="text-muted text-sm text-pretty">
          La web de reservas está operada por {dato(OPERADOR.titular)} (Salonio)
          como encargado del tratamiento, que trata los datos únicamente
          siguiendo las instrucciones del salón y no los usa para fines
          propios.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">Qué se guarda y por qué</h2>
        <ul className="flex flex-col gap-3">
          <li>
            <b>Tu nombre y tu teléfono</b>, para poder atenderte y avisarte si
            surge un cambio. Base legal: la reserva es un contrato, y estos
            datos hacen falta para cumplirlo.
          </li>
          <li>
            <b>Tu email</b>, si lo das, para mandarte la confirmación y el
            recordatorio de la cita. También es parte del servicio de reserva.
          </li>
          <li>
            <b>Tu historial de citas</b> en este salón, para que quien te
            atienda sepa qué te has hecho antes. Interés legítimo del salón en
            llevar su propia agenda.
          </li>
          <li>
            <b>Novedades y promociones</b>, solo si marcaste esa casilla al
            reservar. Base legal: tu consentimiento, y puedes retirarlo cuando
            quieras desde el enlace que va al final de cada email, sin dar
            explicaciones y sin perder la posibilidad de seguir reservando.
          </li>
          <li>
            <b>Faltas de asistencia</b>, si el salón usa el sistema de avisos
            por citas a las que no se acude. Interés legítimo: una silla vacía
            sin avisar es una pérdida real para un negocio pequeño.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Cuánto tiempo</h2>
        <p className="text-pretty">
          Mientras sigas siendo cliente del salón. Si pides que se borren tus
          datos, se borran, salvo lo que haya que conservar por obligación
          legal —una factura, por ejemplo, se guarda los años que exige
          Hacienda—.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Quién más los ve</h2>
        <p className="text-pretty">
          Nadie compra ni vende estos datos. Los tratan, por cuenta del salón,
          los proveedores que hacen funcionar la web:
        </p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          {SUBENCARGADOS.map((s) => (
            <li key={s.nombre}>
              <b className="text-ink">{s.nombre}</b> — {s.para} ({s.donde})
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Qué puedes pedir</h2>
        <p className="text-pretty">
          Acceder a tus datos, corregirlos, borrarlos, limitar su uso,
          oponerte a que se traten o llevártelos a otro sitio. Basta con
          pedírselo al salón
          {salon.phone && <> en el {salon.phone}</>}. Si crees que no se te ha
          atendido bien, puedes reclamar ante la{" "}
          <a
            href="https://www.aepd.es"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-brand"
          >
            Agencia Española de Protección de Datos
          </a>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">Cookies</h2>
        <p className="text-pretty">
          Esta web no lleva analítica, ni publicidad, ni rastreadores de
          terceros. Las únicas cookies que se usan son las que mantienen tu
          sesión abierta si entras en tu cuenta: son técnicas, imprescindibles
          para que la web funcione, y por eso no hace falta pedirte permiso
          para ellas.
        </p>
      </section>

      <p className="text-xs text-muted border-t border-line pt-6">
        Si algo de esto no se entiende, pregúntale al salón — está para eso.
      </p>
    </main>
  );
}

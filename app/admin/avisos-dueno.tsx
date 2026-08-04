"use client";

import AvisosPush from "@/app/avisos-push";
import { guardarPushDueno } from "./actions";

/**
 * El aviso para el dueño, atado a su cuenta.
 *
 * Lo que gana él no es comodidad: una cancelación a última hora solo se
 * rellena si se entera al momento, y el correo no se mira entre cliente y
 * cliente. Lo que gana el proyecto es cuota — sus tres avisos por cita eran
 * correo puro, y son para un único destinatario con un único móvil.
 */
export default function AvisosDueno({ claveVapid }: { claveVapid: string }) {
  return (
    <AvisosPush
      claveVapid={claveVapid}
      guardar={guardarPushDueno}
      textoBoton="Avisarme en este móvil"
      textoAyuda="Reservas nuevas, cancelaciones y valoraciones bajas, en el momento en que pasan."
      textoActivo="Te avisaremos en este móvil de cada reserva y cancelación."
    />
  );
}

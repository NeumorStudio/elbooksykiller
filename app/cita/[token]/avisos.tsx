"use client";

import AvisosPush from "@/app/avisos-push";
import { guardarPush } from "./actions";

/**
 * El aviso para el cliente, atado a SU cita.
 *
 * La lógica de permisos y suscripción vive en `AvisosPush`, que es la misma
 * para todo el mundo; lo que cambia aquí es la credencial —el token de la
 * cita demuestra que quien suscribe el móvil es el dueño de esa reserva— y
 * lo que se le promete, que es un recordatorio y nada más.
 */
export default function Avisos({
  token,
  claveVapid,
}: {
  token: string;
  claveVapid: string;
}) {
  return (
    <AvisosPush
      claveVapid={claveVapid}
      guardar={(sub) => guardarPush(token, sub)}
      textoAyuda="Te avisamos el día antes y una hora antes de tu cita. Nada más."
      textoActivo="Te avisaremos en este móvil antes de tu cita."
    />
  );
}

import "server-only";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Notificaciones push del recordatorio de cita.
 *
 * Por qué existe habiendo email: el recordatorio sale a una hora de la
 * cita, y a esa hora nadie abre el correo. Una notificación en el móvil sí
 * se ve, y es el aviso que evita la falta — el problema que las
 * penalizaciones castigan pero no previenen.
 *
 * Todo es best-effort y nunca lanza, igual que el email: un push caído no
 * puede tumbar el cron ni impedir que salga el aviso por correo.
 */

const PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVADA = process.env.VAPID_PRIVATE_KEY;
// mailto: obligatorio en VAPID — es a quien avisa el servicio de push si
// algo va mal con nuestros envíos.
const SUJETO = process.env.VAPID_SUBJECT ?? "mailto:neumorstudio@gmail.com";

export const pushConfigurado = () => !!(PUBLICA && PRIVADA);

if (pushConfigurado()) {
  webpush.setVapidDetails(SUJETO, PUBLICA!, PRIVADA!);
}

export type Aviso = {
  titulo: string;
  cuerpo: string;
  url: string;
  icono?: string;
  tag?: string;
};

/**
 * Manda el aviso a todos los dispositivos de un cliente.
 *
 * Devuelve cuántos llegaron. Cero significa «no tiene push»: quien llama
 * decide entonces si manda el email, para no avisar dos veces del mismo.
 *
 * Los endpoints muertos se borran en el momento. Un móvil que desinstaló la
 * app o retiró el permiso responde 404 o 410 para siempre; reintentarlo
 * cada hora es gastar tiempo del cron y ensuciar los registros.
 */
export async function enviarPush(customerId: string, aviso: Aviso): Promise<number> {
  if (!pushConfigurado()) return 0;
  try {
    const admin = supabaseAdmin();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("customer_id", customerId);
    if (!subs?.length) return 0;

    const payload = JSON.stringify(aviso);
    let entregados = 0;
    const muertos: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 3600 } // caduca con la cita: un aviso de «en 1 hora» que
            //               llega tres horas después miente.
          );
          entregados++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) muertos.push(s.id);
          else console.error("[push] fallo enviando:", code, (e as Error).message);
        }
      })
    );

    if (muertos.length) {
      await admin.from("push_subscriptions").delete().in("id", muertos);
    }
    return entregados;
  } catch (e) {
    console.error("[push] error general:", (e as Error).message);
    return 0;
  }
}

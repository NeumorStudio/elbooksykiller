# Tareas programadas (crons)

Los endpoints existen y funcionan, pero **no tienen disparador automático**
todavía. Se quitaron de `vercel.json` porque el **plan Hobby de Vercel solo
permite crons una vez al día**, y estos necesitan correr cada hora — un solo
cron sub-diario hace que Vercel **rechace el despliegue entero**.

Cada endpoint está protegido con `CRON_SECRET`: el disparador debe enviar la
cabecera `Authorization: Bearer <CRON_SECRET>`.

| Endpoint | Cada | Qué hace |
|---|---|---|
| `/api/cron/recordatorios` | 1 h (`0 * * * *`) | Recordatorio 24 h antes de la cita |
| `/api/cron/autocompletar` | 1 h (`30 * * * *`) | Marca `completed` lo que ya pasó → dispara los sellos |
| `/api/cron/resenas` | 1 h (`45 * * * *`) | Pide valoración 2-3 h tras el servicio |
| `/api/cron/newsletter` | 15 min (`*/15 * * * *`) | Envía las campañas encoladas por tandas |

> **Consecuencia práctica, por si no es obvia:** sin disparador, una campaña de
> newsletter se queda en «Enviando…» para siempre. Y como `autocompletar` es
> quien marca las citas como `completed`, los segmentos *racha*, *enfriándose*
> y *nuevos* devuelven cero destinatarios: dependen de ese estado.

## Cómo activarlos

**Opción 0 — servidor propio (gratis, la recomendada):** ya existe
`scripts/cron-droplet.sh`, listo para instalar en un servidor encendido 24/7.
Lee el `CRON_SECRET` de `/etc/elbooksykiller.env` y llama a los cuatro
endpoints con los mismos horarios que tenía `vercel.json`. Instrucciones de
instalación en la cabecera del propio script.

**Opción A — Vercel Pro (~20 $/mes):** volver a crear `vercel.json` con el
bloque `crons` de la tabla. Pro admite granularidad de minutos.

**Opción B — GitHub Actions (gratis):** un workflow programado que haga
`curl` a cada endpoint con la cabecera del secreto. Requiere `CRON_SECRET` y
la URL de producción como secrets del repo.

**Opción C — Servicio externo** (cron-job.org, EasyCron): igual que B pero
sin GitHub Actions.

La ventana de cada cron es amplia (p. ej. recordatorios barre 23-25 h), así
que tolera que el disparo no sea puntual al minuto.

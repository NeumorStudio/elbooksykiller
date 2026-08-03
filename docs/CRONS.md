# Tareas programadas (crons)

**Están funcionando.** Los dispara `pg_cron` desde la propia base de Supabase,
no Vercel. Comprobado el 2026-07-26: 288 ejecuciones en 24 h, **0 fallos**,
todas HTTP 200.

> Este documento decía lo contrario —«los endpoints no tienen disparador
> automático»— y siguió diciéndolo semanas después de que se montaran. Costó
> una tarde dar por rotas cosas que iban bien. Si vuelves a tocar los crons,
> actualiza esto en el mismo commit.

## Por qué no van en Vercel

El plan Hobby solo admite **un cron al día**, y estos necesitan correr cada
hora o menos. Peor: un cron sub-diario en `vercel.json` hace que Vercel
**rechace el despliegue entero**, así que ese fichero se borró.

`pg_cron` sale gratis, no depende de ningún servidor extra y tiene un efecto
lateral que interesa: la base recibe actividad cada 10 minutos, así que
**nunca se pausa** por inactividad — un proyecto Free de Supabase se suspende
a los 7 días sin uso.

## Qué hay programado

| Job | Cuándo | Qué hace |
|---|---|---|
| `recordatorios` | `*/10 * * * *` | Dos avisos por cita: la víspera (~24 h) y 1 h antes |
| `autocompletar` | `30 * * * *` | Marca `completed` lo ya pasado → dispara los sellos |
| `resenas` | `45 * * * *` | Pide valoración 2-3 h tras el servicio |
| `newsletter` | `*/15 * * * *` | Despacha las campañas encoladas, en tandas de 60 |

Todos llaman a `https://reservas.neumorstudio.com/api/cron/<nombre>` con la
cabecera `Authorization: Bearer <CRON_SECRET>`.

**`recordatorios` manda dos avisos por cita y no hay que dar de alta nada nuevo
en `pg_cron`:** el mismo endpoint recorre las dos ventanas en cada pasada.

| Aviso | Cuándo sale | Para qué |
|---|---|---|
| `vispera` | 23 h 50 – 24 h 10 antes | Que suelte la cita mientras el hueco aún se vende |
| `hora` | 50 – 70 min antes | Que no se le olvide |

**El de 1 h roza la ventana de cancelación.** El margen para cancelar desde el
enlace es de 1 hora (`lib/cancelacion.ts`), así que en la misma tanda hay citas
que aún se pueden cancelar y citas que ya no. Por eso el botón del correo lo
decide cada cita: «Ver o cancelar mi cita» o «Ver mi cita». Si se toca la
cadencia del cron o el margen, mirar los dos a la vez.

**Quién ha recibido qué lo guarda la tabla `reminders`** (migración 0027), no
Resend. Las ventanas son más anchas que el intervalo del cron a propósito —para
que un tick perdido no deje a nadie sin aviso—, así que cada cita cae en dos o
tres pasadas: insertar la fila es pedir el turno, y solo quien lo consigue
envía. Antes esto lo tapaba la deduplicación de Resend, que **no cubría el
push**: el móvil vibraba una vez por pasada. Al mover una cita se borra su fila,
para que el aviso de la fecha nueva vuelva a salir.

**`autocompletar` es el que más se echa de menos si falla:** es quien pone las
citas en `completed`, y de ese estado dependen los sellos de fidelidad y los
segmentos de la newsletter (`racha`, `enfriándose`, `nuevos`). Si una campaña
dice que no hay destinatarios, mira aquí antes que en el panel.

## Cómo mirar si van

No hacen falta los logs de Vercel — que en Hobby duran **1 hora** y se
evaporan antes de que nadie se entere del problema. La base guarda el
historial, y ese es el log bueno:

```sql
-- Qué hay programado y si está activo
select jobid, jobname, schedule, active from cron.job order by jobid;

-- Ejecuciones y fallos del último día
select j.jobname,
       count(*) filter (where d.status = 'succeeded') as ok,
       count(*) filter (where d.status <> 'succeeded') as fallos,
       max(d.start_time) as ultima
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '24 hours'
group by j.jobname;

-- Qué contestó el endpoint
select id, status_code, content, created
from net._http_response order by id desc limit 20;
```

Un 200 con `{"enviados":0}` es normal: no había nada que hacer en esa pasada.
Un **401** es `CRON_SECRET` desincronizado entre Vercel y el job. Un **404**,
que la URL apunta a un despliegue que ya no existe.

## Cambiar la URL sin filtrar el secreto

El `command` de cada job lleva el `Bearer` dentro. Para reapuntarlos no lo
copies a mano ni lo imprimas: sustituye solo el trozo de la URL.

```sql
select cron.alter_job(
  jobid,
  command := replace(command, 'https://viejo.example', 'https://nuevo.example')
)
from cron.job
where command like '%viejo.example%';
```

## Conectarse a la base

No hay `psql` en la máquina de trabajo, y el host directo
(`db.<ref>.supabase.co`) **solo resuelve por IPv6**, así que falla. Se entra
por el pooler en modo sesión, que además admite DDL:

```
postgresql://postgres.<ref>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
```

Para SQL suelto basta con `npm i pg` en una carpeta temporal y un script de
tres líneas.

## Si algún día se vuelve a Vercel

Con el plan Pro los crons nativos admiten granularidad de minutos: bastaría
recrear `vercel.json` con la tabla de arriba **y borrar los jobs de
`cron.job`**, o cada aviso saldría por duplicado. Mientras tanto, no toques
`vercel.json`.

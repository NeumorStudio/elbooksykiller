# Correo (Resend)

Todo el correo del producto sale por **Resend**, con una única llamada en todo el código:
`resend.emails.send()` en `lib/email.ts`. Ni audiencias, ni contactos, ni dominios, ni gestión de
claves — solo enviar.

| | |
|---|---|
| Dominio | `neumorstudio.com`, verificado, región `eu-west-1` |
| Remitente | `EMAIL_FROM=Reservas <citas@neumorstudio.com>` |
| Plan | Free: **100 correos al día**, y la cuenta es compartida con otros proyectos |

## Qué va por correo y qué por notificación

No hay ningún aviso que salga por los dos canales: `enviarPush()` devuelve
cuántos han llegado, y el correo solo se manda si son cero.

| Aviso | Para | Canal |
|---|---|---|
| Cita confirmada | Cliente | **Correo siempre** — es el comprobante y lleva el enlace permanente; además, al reservar aún no está suscrito a nada |
| Cancelada por el salón | Cliente | **Correo siempre** — es el aviso con más consecuencias, tiene que poder releerse |
| Newsletter | Cliente | **Correo siempre** — marketing por notificación quema el permiso |
| Recordatorio víspera | Cliente | push → correo |
| Recordatorio 1 h | Cliente | push, y correo **solo si no hubo víspera** |
| Valoración, falta, cita movida | Cliente | push → correo |
| Reserva nueva, cancelación, nota baja | Dueño | push → correo |

El de 1 h no gasta correo cuando ya se avisó el día antes: a esa hora nadie
mira la bandeja de entrada y ni siquiera queda margen para cancelar. Quien
reservó el mismo día sí lo recibe, porque es su único aviso.

Con la agenda llena de un salón (18 huecos), esto son ~54 correos al día en
vez de 90 — y bajan a ~36 en cuanto el dueño activa sus avisos en el móvil.

Sin `RESEND_API_KEY` los envíos **se saltan en silencio** y solo queda un `console.warn`
(`lib/email.ts`). En local eso es lo normal; en producción sería un fallo invisible.

## Una clave por entorno, y solo de envío

La cuenta de Resend es compartida con otros proyectos, así que cada uno lleva su clave con nombre
propio. Las de este proyecto:

| Clave (nombre en Resend) | Dónde vive |
|---|---|
| `elbooksykiller local (solo envio)` | `.env.local` de cada uno, en su máquina |
| `salonio produccion (solo envio)` | Variable de Vercel del proyecto `salonio`, Production y Preview |

Las dos son **`sending_access`**, no de acceso completo. La diferencia importa: una clave completa
puede listar y **crear** claves nuevas, borrar el dominio `neumorstudio.com` —lo que tumbaría el
correo de todos los proyectos de la cuenta—, leer los correos ya enviados con sus destinatarios, y
enviar desde cualquier dirección del dominio pasando SPF y DKIM.

Una clave que solo envía no puede nada de eso. Y como la clave del `.env` es la copia que acaba
filtrándose —en un pantallazo, en un chat, en un pegado a la persona equivocada—, es la que menos
poder debe tener.

**El poder de administración va en el panel de Resend con tu sesión, no en un fichero `.env`.** Si
algún día hace falta un script que gestione dominios o audiencias, ese script lleva su propia clave
completa y no vive en el entorno de la app.

Que sean **dos claves y no una** también es a propósito: si te roban el portátil, se revoca la de
local y producción sigue enviando.

**Las claves antiguas de acceso completo NO se han borrado**, y es deliberado: ya no las usa nadie,
pero borrar una credencial que quizá siga en el `.env.local` de otro rompe su entorno sin avisar.
Se quedan vivas hasta que ambos confirméis que no las tenéis. Una clave sin usar molesta poco;
borrar una que alguien usa es un problema inmediato.

## Qué está comprobado (31-07-2026)

Reserva de prueba en el preview de `dev`, que usa la misma clave restringida que producción:

- ✅ **La clave restringida envía desde la app desplegada.** Reserva creada a las 19:08:06 UTC, la
  clave marcó uso a las 19:08:08, y el correo **«Cita confirmada»** llegó `delivered`.
- ✅ **El aviso «Nueva reserva» al dueño falla solo en dev, y ya se sabe por qué.** No es cosa de
  Resend ni de `lib/notifications.ts`: el usuario dueño de dev tiene cuatro campos de token a NULL
  en `auth.users`, GoTrue los lee como cadena no nula y `getUserById` devuelve 500, así que el
  envío nunca se encola. El detalle y el arreglo, en `CLAUDE.md`.

En producción **el mismo `getUserById` devuelve 200 con el email del dueño del piloto** (probado el
31-07-2026), y los dos correos salían el 27-07-2026. Lo que sigue sin comprobarse en producción es
una reserva de punta a punta, porque desde entonces no ha habido ninguna real.

## Rotar una clave: el orden importa

**Cambiar una variable en Vercel no afecta al despliegue que está corriendo.** Entra en vigor en el
siguiente build. Así que:

1. Crear la clave nueva (`sending_access`)
2. Ponerla en Vercel
3. **Desplegar**
4. **Y solo entonces** borrar la vieja

Saltarse el 3 deja al salón sin enviar correos hasta el siguiente despliegue.

## Cómo saber qué clave es cuál sin conocer su token

Resend no permite volver a ver el valor de una clave, y la lista solo devuelve `id`, `name`,
`created_at` y `last_used_at`. Para identificar una clave que tienes en la mano pero no sabes cuál
de la lista es: **úsala para cualquier petición y mira qué entrada cambia su `last_used_at` a
ahora mismo.**

```bash
curl -s https://api.resend.com/api-keys -H "Authorization: Bearer <la clave>"
```

Esto evitó un estropicio el 30-07-2026: una clave que parecía la de este proyecto era en realidad
la de otro, y borrarla habría tumbado su correo.

`last_used_at` sirve también para lo contrario: una clave sin usar en meses es candidata a borrar
—pero antes hay que confirmar de quién es, porque puede alimentar algo que corre una vez al mes.

## Ver el consumo

**No hay endpoint de consumo en la API**; el contador solo está en el panel. Lo que sí se puede es
listar lo enviado, que da el volumen real:

```bash
curl -s https://api.resend.com/emails -H "Authorization: Bearer <clave completa>"
```

Requiere clave completa, así que se hace desde el panel o con una clave de administración
temporal — no con la de la app.

## Documentos vecinos

- `docs/CRONS.md` — los cuatro crons, dos de ellos disparan correos
- `docs/ONBOARDING_DEV.md` — ramas, bases y flujo

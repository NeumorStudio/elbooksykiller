# Correo (Resend)

Todo el correo del producto sale por **Resend**, con una única llamada en todo el código:
`resend.emails.send()` en `lib/email.ts`. Ni audiencias, ni contactos, ni dominios, ni gestión de
claves — solo enviar.

| | |
|---|---|
| Dominio | `neumorstudio.com`, verificado, región `eu-west-1` |
| Remitente | `EMAIL_FROM=Reservas <citas@neumorstudio.com>` |
| Plan | Free: **100 correos al día** |

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

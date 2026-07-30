@AGENTS.md

# elbooksykiller — contexto para Claude

SaaS de reservas para peluquerías (repo `NeumorStudio/elbooksykiller`). En Vercel el proyecto se
llama **`salonio`**, y su dominio de producción es `reservas.neumorstudio.com`.

## Reparto de trabajo

Edwin lleva el diseño y **también toca la parte técnica**; su compañero (`cmateos91`) lleva el
resto. El repo es compartido: avisar antes de tocar ramas compartidas y ofrecer rama + PR.

## Las dos ramas y las dos bases

| Rama | Base de datos | Dónde |
|---|---|---|
| `dev` | `cjyfbmyidqubqikkbvpx` | Preview de Vercel |
| `main` | `vgwhornipwxicyfknafm` | `reservas.neumorstudio.com` |

Se trabaja en `dev` y se mergea a `main` cuando funciona. **`main` NO está protegida**: se decidió a
propósito el 30-07-2026 no exigir PR, porque sois dos y la ceremonia estorbaba más de lo que
aportaba. Es una convención, no una barrera técnica. Detalle en `docs/ONBOARDING_DEV.md`.

⚠️ **Una rama que no sea `dev` hereda las variables genéricas de Preview, que apuntan a
PRODUCCIÓN.** Solo `dev` tiene las suyas hacia la base de dev. Comprobado el 30-07-2026
descargando las dos. Por eso: `dev` y ya.

## Reglas de prueba (no saltárselas)

- **Probar en la base de dev**, no en prod. En local eso lo decide `BD=dev` en `.env.local`.
- **Nunca** sobre el piloto real `paye-villalobos`: es el cliente de verdad.
- En prod hay un salón de pruebas, pero está **`blocked`** desde el 30-07-2026: su web pública da
  «no encontrado» y no admite reservas. Se cerró porque cada reserva gasta correos de una cuota
  compartida de 100/día, y quien supiera la URL podía dejar sin correo a la peluquería de verdad.
  Su dueño es el superadmin, así que sigue entrando al panel. **Probar en la base de dev.**
- Borrar los datos de prueba al terminar.
- Las credenciales están en la ficha de memoria `elbooksykiller-equipo-y-marca`, no aquí
  (esto se commitea).

## Cómo verificar

Hay **Playwright en `/tmp/pw`** con una sesión de admin reutilizable (`sesion-admin.json`) para
capturas y medición. No decir que algo funciona sin haberlo ejecutado.

El gestor de paquetes es **npm** (`package-lock.json`). Build: `npm run build`.

## ⚠️ Sin resolver: el aviso al dueño puede no estar saliendo

Reserva de prueba en el preview de `dev` el **30-07-2026 a las 19:08 UTC**: salió «Cita confirmada»
al cliente (`delivered`) pero **NO salió «Nueva reserva» al dueño**, aunque `lib/notifications.ts`
encola los dos y el dueño del salón de dev sí tiene email. El aviso al dueño resuelve la dirección
con `admin.auth.admin.getUserById(salon.owner_id)` — mirar ahí.

En producción **sí salían los dos** el 27-07-2026, así que puede ser cosa de dev. Pero desde
entonces no ha habido ninguna reserva real, así que **no está comprobado que hoy funcione**. Si
falla, el salón no se entera de sus citas. Es lo primero que revisar.

## Trampas conocidas

- **`.env.local` manda solo en tu máquina.** Lo desplegado usa las variables de Vercel y no lee
  ese fichero jamás. El interruptor `BD=dev`/`BD=prod` lo aplica `next.config.ts`, así que **solo
  vale bajo Next**. Sin el trío `SUPABASE_DEV_*` completo avisa y **cae a producción**.
- **`scripts/backup.mjs` NO pasa por `next.config.ts`:** lee `NEXT_PUBLIC_SUPABASE_URL` y
  `SUPABASE_SERVICE_ROLE_KEY` directamente del fichero. Esas dos tienen que seguir apuntando a
  **prod**, que es de lo que hay que hacer copias. No repuntarlas a dev.
- **`salons.opens_at` no se puede cambiar desde el panel** — no hay campo ni en `/admin` ni en el
  super. Cada cambio de fecha es un UPDATE a mano. Hueco de producto pendiente.
- **`opens_at` filtra por el día de la CITA, no por hoy.** Con `opens_at = 2026-08-07` se puede
  reservar hoy para el 11 de agosto; lo que se bloquea es coger cita para antes del día 7. El
  filtro vive en `available_slots()` y `available_slots_combo()`, y `create_booking()` lo hereda.
- **`_backup_salones_borrados` existe solo en prod y no la crea ninguna migración.** Nació sin
  RLS y abierta a `anon`; se blindó en la `0024`. Si se recrea, hay que blindarla otra vez.
- **`push_subscriptions` tiene RLS sin políticas a propósito**: falla cerrado y se accede por
  `service_role`. El linter lo marca como aviso; no es un fallo.
- **Un salón `blocked` sigue filtrando su nombre en el `<title>`.** El cuerpo sí da «no
  encontrado» —sin formulario ni servicios—, pero `generateMetadata` corre aparte de la página y no
  comprueba `blocked`. Cosmético, pero engaña al verificar: mirar el cuerpo, no el título.
- **Un slug inexistente devuelve HTTP 200, no 404.** `app/[slug]/page.tsx:123` llama a
  `notFound()`, pero la respuesta sale con 200 igual (comprobado el 30-07-2026 con
  `x-vercel-cache: MISS`, así que no es caché). Sospecha: `htmlLimitedBots: /.*/` cambia el modo de
  render y el estado ya no se puede fijar. Malo para SEO —Google indexa URLs basura como válidas— y
  pendiente de arreglar con cuidado, porque esa opción es la que hace instalable la PWA.
- El dominio bueno del salón piloto es `payevillalobos.neumorstudio.com`. El de
  `elbooksykiller.vercel.app` **no es de este proyecto** y da 404 para ese salón.

## Diseño

Antes de proponer nada visual, mirar la ficha `disenos-rechazados`: la banda del poste, la
sección de equipo y el fondo marrón **ya se descartaron**. No volver a proponerlos.

Vercel está en plan **Hobby** con un cliente real cogiendo citas — ver la ficha
`salonio-vercel-hobby-blindaje` antes de proponer nada que consuma funciones serverless.

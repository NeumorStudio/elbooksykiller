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

Se trabaja en `dev` y se mergea a `main` cuando funciona. `main` está **protegida**: exige PR.
Detalle completo en `docs/ONBOARDING_DEV.md`.

⚠️ **Una rama que no sea `dev` hereda las variables genéricas de Preview, que apuntan a
PRODUCCIÓN.** Solo `dev` tiene las suyas hacia la base de dev. Comprobado el 30-07-2026
descargando las dos. Por eso: `dev` y ya.

## Reglas de prueba (no saltárselas)

- **Probar en la base de dev**, no en prod. En local eso lo decide `BD=dev` en `.env.local`.
- **Nunca** sobre el piloto real `paye-villalobos`: es el cliente de verdad.
- En prod hay un salón de pruebas, **`salon-de-pruebas-d74a4b`** (el sufijo es a propósito, para
  que no se encuentre adivinando el slug). Es de su compañero: preguntar antes de usarlo.
- Borrar los datos de prueba al terminar.
- Las credenciales están en la ficha de memoria `elbooksykiller-equipo-y-marca`, no aquí
  (esto se commitea).

## Cómo verificar

Hay **Playwright en `/tmp/pw`** con una sesión de admin reutilizable (`sesion-admin.json`) para
capturas y medición. No decir que algo funciona sin haberlo ejecutado.

El gestor de paquetes es **npm** (`package-lock.json`). Build: `npm run build`.

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

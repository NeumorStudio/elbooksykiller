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

Hay **Playwright instalado en `/tmp/pw`** (y `pg`, para SQL suelto). Ojo: ahí **ya no queda ninguna
sesión de admin guardada** —el `sesion-admin.json` que hubo se perdió, comprobado el 31-07-2026—,
así que hay que volver a iniciar sesión y, si se quiere reutilizar, guardar el `storageState`.

No decir que algo funciona sin haberlo ejecutado.

El gestor de paquetes es **npm** (`package-lock.json`). Build: `npm run build`.

## El aviso al dueño: resuelto el 31-07-2026, y es solo de dev

El síntoma era que en el preview de `dev` salía «Cita confirmada» al cliente pero **no** «Nueva
reserva» al dueño. **El código está bien**; lo que está roto son los datos de `auth.users` en dev.

El usuario dueño de dev se insertó a mano por SQL, y eso dejó `confirmation_token`,
`recovery_token`, `email_change_token_new` y `email_change` a **NULL**. GoTrue los lee como cadena
no nula, así que revienta:

```
error finding user: sql: Scan error on column index 3, name "confirmation_token":
converting NULL to string is unsupported     ← log de auth, 30-07-2026 19:08:07 UTC
```

`getUserById` devuelve **500**, el `?? null` del código se lo traga y el correo no se encola.
**Producción no está afectada:** los cinco usuarios tienen esos campos a cadena vacía, y
`getUserById` del dueño del piloto devuelve 200 con su email (comprobado el 31-07-2026).

Se arregla poniendo `''` en esos cuatro campos del usuario de dev. **Mientras no se arregle, en dev
fallan en silencio cuatro sitios**, no uno: `lib/notifications.ts:90` (aviso de nueva reserva),
`app/cita/[token]/actions.ts:31` (aviso cuando el cliente cancela) y `app/admin/super/page.tsx:47`
+ `actions.ts:46` (el panel del super enseña «—» en vez del email de cada dueño, porque
`listUsers` da el mismo 500).

## Trampas conocidas

- **`.env.local` manda solo en tu máquina.** Lo desplegado usa las variables de Vercel y no lee
  ese fichero jamás. El interruptor `BD=dev`/`BD=prod` lo aplica `next.config.ts`, así que **solo
  vale bajo Next**. Sin el trío `SUPABASE_DEV_*` completo avisa y **cae a producción**.
- **`scripts/backup.mjs` NO pasa por `next.config.ts`:** lee `NEXT_PUBLIC_SUPABASE_URL` y
  `SUPABASE_SERVICE_ROLE_KEY` directamente del fichero. Esas dos tienen que seguir apuntando a
  **prod**, que es de lo que hay que hacer copias. No repuntarlas a dev.
- **`scripts/smoke-test.sh` tampoco pasa por `next.config.ts`, y por eso apunta a producción.**
  Lee `NEXT_PUBLIC_SUPABASE_*` del fichero igual que el backup, así que `BD=dev` no le afecta:
  daría de alta un usuario, un salón y **una reserva de verdad en prod**. Además está **roto**
  desde la `0023`, que revocó el INSERT sobre `salons` — muere en el paso 2, pero después del
  signup del paso 1 y antes de la limpieza del paso 8, así que deja el usuario huérfano en
  `auth.users` de producción. **No ejecutarlo** hasta que se le ponga el interruptor de base.
- **`salons.opens_at` no se puede cambiar desde el panel** — no hay campo ni en `/admin` ni en el
  super. Cada cambio de fecha es un UPDATE a mano. Hueco de producto pendiente.
- **`opens_at` filtra por el día de la CITA, no por hoy.** Con `opens_at = 2026-08-07` se puede
  reservar hoy para el 11 de agosto; lo que se bloquea es coger cita para antes del día 7. El
  filtro vive en `available_slots()` y `available_slots_combo()`, y `create_booking()` lo hereda.
- **`_backup_salones_borrados` existe solo en prod y no la crea ninguna migración.** Nació sin
  RLS y abierta a `anon`; se blindó en la `0024`. Si se recrea, hay que blindarla otra vez.
- **`push_subscriptions` tiene RLS sin políticas a propósito**: falla cerrado y se accede por
  `service_role`. El linter lo marca como aviso; no es un fallo.
- **Un slug inexistente devuelve HTTP 200, no 404 — y se queda así a propósito.** La causa no era
  `htmlLimitedBots`, como se sospechaba: es el `loading.tsx` de `[slug]`. Al renderizarse ese
  fallback la respuesta ya ha empezado a enviarse, y Next no puede cambiar las cabeceras después
  («the status code of the response cannot be updated», su propia documentación de streaming).
  Comprobado el 03-08-2026 quitando ese fichero: entonces sí sale 404. Se mantiene el 200 porque
  Next añade `<meta name="robots" content="noindex">` al streamear un 404 —verificado en
  producción—, así que Google **no** lo indexa: lo etiquetará como *soft 404*. El precio de
  arreglarlo era perder el esqueleto de carga de la pantalla más visitada, o meter una consulta en
  el proxy por cada visita. Si algún día hace falta el 404 de verdad (analítica, cumplimiento), esas
  son las dos vías.
- **Al leer `salons` con la sesión anónima, ojo con las columnas.** `anon` solo tiene SELECT sobre
  las públicas (la 0016 lo recortó columna a columna): pedir `blocked`, `modules`, `owner_id` o
  `stripe_account_id` no devuelve la fila sin ese campo, **falla la consulta entera** y el salón
  parece no existir. Para eso está `supabaseAdmin()`.
- El dominio bueno del salón piloto es `payevillalobos.neumorstudio.com`. El de
  `elbooksykiller.vercel.app` **no es de este proyecto** y da 404 para ese salón.

## Diseño

Antes de proponer nada visual, mirar la ficha `disenos-rechazados`: la banda del poste, la
sección de equipo y el fondo marrón **ya se descartaron**. No volver a proponerlos.

Vercel está en plan **Hobby** con un cliente real cogiendo citas — ver la ficha
`salonio-vercel-hobby-blindaje` antes de proponer nada que consuma funciones serverless.

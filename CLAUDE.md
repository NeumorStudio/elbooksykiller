@AGENTS.md

# elbooksykiller — contexto para Claude

SaaS de reservas para peluquerías (repo `NeumorStudio/elbooksykiller`). En Vercel el proyecto se
llama **`salonio`**, y su dominio de producción es `reservas.neumorstudio.com`.

## Reparto de trabajo

Edwin lleva el diseño y **también toca la parte técnica**; su compañero (`cmate0s`) lleva el
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

## Dónde está el piloto (04-08-2026)

**Paye Villalobos abre el viernes 7 de agosto** y ya tiene **19 citas** cogidas (10 el viernes, 8
el sábado, 1 el lunes). Datos que conviene tener en la cabeza antes de tocar producción:

- **Solo 4 de cada 14 clientes dejan correo**, y hay **una sola suscripción push** en toda la
  base. La mayoría de las citas entran por teléfono y las apunta el dueño a mano: de ahí el botón
  de WhatsApp del panel, que es hoy la única forma de que esa gente reciba el enlace de su cita.
- **Su tarjeta sigue en «6 visitas → Corte gratis»**; quiere 9 y 15, y lo cambia él desde su
  panel. Hay **0 sellos dados**, así que cambiar los números no le quita el progreso a nadie.
- **Cobros sigue apagado** (`charges_enabled = false`): no cobra online, así que la rama de
  reembolso al cancelar no se ejecuta nunca en su caso.
- **El programa de faltas está sin configurar.** Marcar «no vino» no tiene consecuencia hasta que
  lo active en *Clientes → Penalizaciones*.

## El navegador no habla con Supabase

Supabase está detrás de Cloudflare, y los días de partido los bloqueos de LaLiga cortan esas IPs en
los operadores españoles. Vercel no está bloqueado, así que todo lo que el cliente necesita pasa por
nuestro dominio:

- Horas libres: `/api/huecos`. Nunca `supabaseBrowser().rpc(...)`.
- Login del dueño y enlace del cliente: server actions.
- Fotos del Storage: `urlMedia()` de `lib/media.ts`, que las sirve por `/media/*`.

Lo único que sigue yendo directo es entrar con Google o Apple, porque el proveedor redirige allí.

**No hay app móvil nativa en producción: todo lo que usa la gente es esta PWA.** Hubo un intento
con Expo que llamaba directo a Supabase; se dejó a medias y se descartó. La app nueva se está
haciendo desde cero y su base de datos irá en InsForge, no en Supabase, así que no hay que
preparar nada en este repo para ella. Los endpoints y la migración 0035 que se hicieron para
aquella versión se revirtieron (`1813819`), y la numeración salta de la 0034 a la 0036 por eso.

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

No decir que algo funciona sin haberlo ejecutado.

El gestor de paquetes es **npm** (`package-lock.json`). Build: `npm run build`.

**Playwright**: la instalación de `/tmp/pw` está a medias (sin `package.json`, no se puede
importar). Lo que funciona es instalarlo en una carpeta temporal propia —`npm i playwright` y
`npx playwright install chromium`— y trabajar desde ahí; hay `pg` en `/tmp/pw` para SQL suelto.

**Para entrar al panel sin la contraseña del dueño**, el truco es el mismo que usa el «Entrar
como» del superadmin: generar un magic link con service role, canjearlo con `verifyOtp` y montar
la cookie de `@supabase/ssr`, que es `sb-<ref>-auth-token` con valor `base64-<json en base64>`.
Con esa cookie se puede pedir cualquier página del panel.

⚠️ **Las server actions que reciben `FormData` no se pueden invocar por HTTP desde fuera**: el
POST muere con «Connection closed» incluso para acciones que funcionan en el navegador. Las que
reciben argumentos serializables sí (cabecera `Next-Action` + `Content-Type: text/plain`). Para
todo lo demás, navegador de verdad.

⚠️ **La generación de iconos (`/[slug]/pwa-icon`) revienta en Windows** con
«colourspace: parameter space not set», sea cual sea el tamaño y también con `next start`. Es
sharp sobre Windows, no el código: en Vercel responde `200 image/png`. No se puede comprobar en
local.

## El aviso al dueño en dev: arreglado el 04-08-2026

Estuvo roto porque el usuario de dev se insertó a mano por SQL y eso dejó `confirmation_token`,
`recovery_token`, `email_change_token_new` y `email_change` a **NULL**. GoTrue los lee como cadena
no nula, `getUserById` devolvía **500**, el `?? null` del código se lo tragaba y no se encolaba
ningún correo. Producción nunca estuvo afectada.

Se arregló poniendo `''` en esos campos (y en los otros cuatro del mismo tipo). **Si se vuelve a
crear un usuario a mano por SQL, volverá a pasar**: crearlos con `auth.admin.createUser()`, que
los inicializa bien.

## Cómo funcionan tres cosas que es fácil romper

**La asistencia manda sobre todo lo demás.** El sello de fidelidad, las faltas y el KPI de no
presentados salen de que una cita pase a `completed` o `no_show`. Por eso la agenda carga también
las cerradas —antes solo pedía `confirmed` y la cita desaparecía al autocompletarse, llevándose
los botones— y por eso el autocompletado espera **12 horas** y no tres: cierra el día por la
noche y deja marcar con calma. Si tocas ese cron o el filtro de la agenda, mira los dos a la vez.

**La fidelidad es una escalera, no una moneda.** `loyalty_rewards.stamps` es **la visita en la que
toca** el premio, no lo que cuesta: se cuentan las visitas de toda la vida (sin filtrar por
`redemption_id`), el contador **no se reinicia** al entregar, y `entregar_premio` impide repetir
escalón. Se montó primero como catálogo con precio y estaba mal: quien cogía el premio barato
volvía a cero y no llegaba nunca al grande. El modelo real es «corte gratis en la visita 9, gel
en la 15», para premiar a quien sigue viniendo.

**Cada aviso sale por un canal, nunca por los dos.** `enviarPush` devuelve cuántos llegaron y el
correo solo se manda si son cero. El reparto completo está en `docs/CORREO.md`, y la ventana de
cancelación —que decide el texto de esos avisos— vive entera en `lib/cancelacion.ts`: si la
cambias ahí, cambia sola en la action, en la página y en los correos.

## Acceso de trabajadores (0033)

Un profesional puede entrar desde su móvil y ver **solo sus citas**. No es un segundo dueño: la
seguridad del dueño (`salons.owner_id = auth.uid()`) no se ha tocado, y el trabajador **no tiene
ninguna política** sobre las tablas del salón. Lee y marca por tres RPC `security definer`
(`mi_puesto`, `mis_citas`, `marcar_mi_cita`) que devuelven solo lo suyo y solo las columnas de la
silla. `employee_access` une ficha y cuenta, y solo la escribe service role desde las actions de
*Equipo*, que antes comprueban con la sesión del dueño que la ficha es suya.

- El enlace del correo va a **`/admin/acceso`**, página nuestra (pública en el proxy), y el token
  se canjea al enviar el formulario, no al abrir: los antivirus de correo abren los enlaces y lo
  gastarían. Es un enlace de `recovery`, así que **caduca con el OTP de Supabase (1 h por defecto)**.
- En el preview de dev el enlace usa `VERCEL_BRANCH_URL`, no `baseUrl()`, que apunta a prod.
- Dar de baja la ficha o bloquear el salón apaga el acceso solo; «Quitar acceso» además borra la
  cuenta si no es también de un cliente.
- Pruebas de la base: `supabase/migrations/comprobar-0033.sql` en el editor SQL de **dev**. Acaba
  en error a propósito para deshacerlo todo; el mensaje es el resultado.

**Permisos (0034).** En *Equipo* el dueño enciende por ficha «Ver la agenda de todo el equipo»
(`ver_agenda_equipo`) y «Apuntar, mover y cancelar citas» (`apuntar_citas`). Nacen apagados. Con
alguno encendido, *Mi agenda* es la **misma `Agenda` del dueño** en modo trabajador (prop
`trabajador`): acciones por las RPC `agenda_equipo`, `apuntar_cita`, `mover_cita_equipo` y
`cancelar_cita_equipo`, que leen los permisos en cada llamada. Sin ninguno, la lista sencilla.
- Apuntar a un compañero exige también ver la agenda del equipo. La asistencia la marca cada uno
  en **sus** citas. Lo pagado online solo lo cancela el dueño (es devolver dinero).
- Las citas que apunta un trabajador llevan `source = 'panel'` puesto a mano: el trigger de la
  0032 solo reconoce al dueño.
- Los avisos al cliente al mover o cancelar viven en `lib/avisos-cita.ts` y los usan el dueño y el
  trabajador. Si cambias el texto o el canal, cambia para los dos.
- Precios, servicios, caja, clientes, fidelización y newsletter **no tienen interruptor**: son del
  dueño. Si algún día se pide un «segundo dueño», es otro diseño, no un permiso más.
- Pruebas: `comprobar-0034.sql` en **dev**, mismo estilo que la de la 0033.
- **Probar la UI del trabajador sin contraseña**: pedir magic link en `/perfil` del preview de dev
  con un alias `+algo` del correo de Edwin, leer el enlace con Gmail y canjear su `token_hash`
  (`pkce_…`) con `POST /auth/v1/verify` desde la propia página del preview, montando la cookie de
  `@supabase/ssr`. El enlace del correo redirige a `localhost:3000` porque el preview no está en
  la lista de redirecciones de dev. Para ver el panel del dueño, cambiar a mano el `owner_id` del
  salón de pruebas a esa cuenta y **restaurarlo** después (el original es `peluquero.demo`).

## Trampas conocidas

- **En el editor SQL de Supabase, un `begin; … rollback;` deshace también lo que va ANTES en el
  mismo script.** El script entero es una transacción implícita y el `begin` la convierte en
  explícita, así que el `rollback` se lleva por delante el `update` de arriba aunque la lectura
  de dentro diga que está hecho. Pasó el 02-11-2026 al encender los permisos de Darwin: parecían
  activos y no lo estaban. Cambios de verdad, en su propia ejecución; comprobar con otra lectura.
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
  parece no existir. Para eso está `supabaseAdmin()`. Lo mismo vale al depurar: un
  `select=*` por REST con la clave anónima siempre dará «permission denied», y no significa que
  la tabla esté rota.
- **Una política `FOR ALL` sobre `public` que mire `salons.owner_id` rompe la lectura anónima.**
  Es la misma trampa de arriba, un piso más abajo, y costó que **los productos del piloto no se
  vieran en su web desde que existen**: para evaluar «¿es este visitante el dueño?» Postgres
  necesita leer `owner_id`, que `anon` tiene prohibida, y la consulta muere entera antes de
  aplicar la política pública que sí le dejaba pasar. Arreglado en la **0030**: las políticas de
  dueño son `TO authenticated`. Si añades una tabla con el patrón «dueño + lectura pública»,
  hazla `TO authenticated` desde el principio.
- **Declarar `icons` en un `generateMetadata` cancela el icono automático de Next.** Al poner solo
  el de Apple, la página se quedaba sin favicon, el navegador se iba a `/favicon.ico`, esa ruta
  cae en `/[slug]` y devuelve **HTML con 200** — y el navegador enseñaba el icono de Vercel. Si
  declaras `icons`, decláralos todos.
- **El icono de salón se cachea un día en el CDN**, así que cambiar el logo o el nombre no se veía
  hasta pasado ese tiempo. Por eso la URL lleva un sello (`?v=`) derivado del logo y del nombre;
  si tocas cómo se genera el icono, mantén ese sello o volverás a servir el viejo.
- **El tope de 4 citas futuras por teléfono (0015) también se aplica al panel**, donde no pinta
  nada —protege de bots anónimos, y el dueño está autenticado— y el error llega a pantalla como
  «Revisa los datos». Una familia con un solo móvil que quiera la quinta cita se queda fuera sin
  entender por qué. **Pendiente**: eximir al dueño y traducir `demasiadas_reservas`.
- **La confirmación de reserva se guarda en `sessionStorage`**, que muere al cerrar el navegador.
  Para quien reservó sin correo y sin activar avisos, ese era su único acceso a la cita.
  **Pendiente**: pasarlo a `localStorage`.
- El dominio bueno del salón piloto es `payevillalobos.neumorstudio.com`. El de
  `elbooksykiller.vercel.app` **no es de este proyecto** y da 404 para ese salón.

## Diseño

Antes de proponer nada visual, mirar la ficha `disenos-rechazados`: la banda del poste, la
sección de equipo y el fondo marrón **ya se descartaron**. No volver a proponerlos.

Vercel está en plan **Hobby** con un cliente real cogiendo citas — ver la ficha
`salonio-vercel-hobby-blindaje` antes de proponer nada que consuma funciones serverless.

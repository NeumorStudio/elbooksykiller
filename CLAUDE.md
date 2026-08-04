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

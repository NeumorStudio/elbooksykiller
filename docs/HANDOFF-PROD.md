# Handoff — encender las funciones nuevas en PRODUCCIÓN

Para el responsable técnico. El objetivo es activar en producción las funciones
que ya están en el código: **área de cliente / «Mi cuenta», tarjeta de
fidelidad, productos, newsletter, reseñas** y el **recordatorio de cita a 1 h**.

## Estado actual

- **Código:** ya en `main` (commit `84d465f`) y **desplegado por Vercel**. No hay
  que tocar código.
- **Base de datos de producción:** `vgwhornipwxicyfknafm`. Confirmado por el
  propietario el 2026-07-20. **Las migraciones 0006–0010 ya están aplicadas**:
  el panel de newsletter muestra el formulario, y eso solo ocurre si existe la
  tabla `newsletter_campaigns`.

  > Corregido el 2026-07-20. Este documento decía antes que producción era
  > `ulhlsyrrpjqhfixupglb` y que `vgwhornipwxicyfknafm` era de pruebas. Era al
  > revés, y llevó a diagnosticar mal un fallo del botón de cancelar.

- **Ojo:** `.env.local` apunta a producción. Cada `npm run dev` escribe en datos
  reales y envía emails reales a clientes reales — con enlaces a `localhost`
  si `PLATFORM_URL` no está definida. Conviene un proyecto Supabase aparte
  para desarrollo.

---

## 1. Aplicar las migraciones 0006–0010

Ya están en `supabase/migrations/`:

| Migración | Qué añade |
|---|---|
| `0006_clientes` | tabla `customers`, `public_token` en `bookings` (área `/cita/[token]`), RPC `features_disponibles()` |
| `0007_fidelizacion` | `loyalty_programs`, `loyalty_stamps` (sellos) |
| `0008_productos` | `products` y apartado de productos junto a la cita |
| `0009_newsletter` | `newsletter_campaigns`, `customers.marketing_opt_in` |
| `0010_resenas` | `review_requests`, `salons.google_review_url` |

```bash
git pull
supabase link --project-ref ulhlsyrrpjqhfixupglb
supabase db push --dry-run        # ver qué aplicaría, sin aplicar
```

⚠️ **Gotcha del historial:** si el dry-run intenta aplicar **de la 0002 en
adelante**, la tabla `supabase_migrations.schema_migrations` está vacía (las
0002–0005 se aplicaron sin registrarse). En ese caso, marcarlas como aplicadas
ANTES del push (verificar antes que esas columnas/tablas ya existen — pagos,
`onboarded`, `logo_url`, etc.):

```bash
supabase migration repair --status applied 00000000000002 00000000000003 00000000000004 00000000000005
supabase migration repair --status reverted 00000000000001   # el init es especial
supabase db push --dry-run        # ahora debería quedar SOLO 0006–0010
```

Y aplicar:

```bash
supabase db push
```

---

## 2. Variables de entorno en Vercel (proyecto `elbooksykiller`)

- **`CRON_SECRET`** = una cadena aleatoria (p. ej. `openssl rand -hex 24`). La
  necesita el disparador del cron (paso 3).
- **`RESEND_API_KEY`** y **`EMAIL_FROM=Reservas <citas@neumorstudio.com>`** —
  el dominio `neumorstudio.com` ya está **verificado en Resend**, así que los
  emails salen de verdad. Confirmar que la key de Vercel es de esa cuenta.

Tras cambiar variables, **redeploy** para que surtan efecto.

---

## 3. Cron en Supabase (`pg_cron` + `pg_net`)

Los endpoints existen y están protegidos con `CRON_SECRET`
(`Authorization: Bearer <CRON_SECRET>`). Ver `docs/CRONS.md` para la tabla
completa. El disparador se puede montar con `pg_cron` en Supabase:

- Habilitar extensiones `pg_cron` y `pg_net`.
- Job **cada ~10 min** → `POST https://<prod>/api/cron/recordatorios` con la
  cabecera del secreto.
- Igual para `/api/cron/autocompletar`, `/api/cron/resenas`,
  `/api/cron/newsletter` (frecuencias en `docs/CRONS.md`).

**Nota:** el recordatorio ahora es **~1 h antes** de la cita (antes 24 h), por
eso el cron debe correr cada ~10 min, no una vez al día. Además **se omite** el
recordatorio si la reserva se hizo con **menos de 1 h de antelación** (el
cliente acaba de recibir la confirmación).

---

## 4. Verificar que quedó encendido

```bash
# la RPC debe devolver todo true
curl -s -X POST "https://ulhlsyrrpjqhfixupglb.supabase.co/rest/v1/rpc/features_disponibles" \
  -H "apikey: <SERVICE_ROLE>" -H "Authorization: Bearer <SERVICE_ROLE>" \
  -H "Content-Type: application/json" -d '{}'
# -> {"clientes":true,"fidelizacion":true,"productos":true,"newsletter":true,"resenas":true}
```

En el sitio en vivo:
- El menú del admin (Clientes / Productos / Newsletter) muestra **contenido real**
  (no «muy pronto»).
- En la web pública aparece el enlace discreto **«¿Ya eres cliente? Entra a tu
  cuenta»** en el pie.

---

## Notas

- Las notificaciones **instantáneas** (confirmación al cliente + aviso al dueño
  al reservar) **no dependen del cron** — funcionan en cuanto Resend esté bien
  en Vercel.
- Los emails solo llegan al cliente si dejó email al reservar (es opcional).
- Todo esto se ensayó con éxito en `vgwhornipwxicyfknafm`; el procedimiento está
  probado.

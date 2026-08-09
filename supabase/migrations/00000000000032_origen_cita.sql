-- De dónde salió cada cita: la pidió el cliente o la apuntó el dueño.
--
-- Se decide con un trigger y no en el código de la app, por lo mismo que
-- `fidelizacion_por_estado`: hay dos caminos de alta —la RPC `create_booking`
-- desde la web pública y el INSERT directo del panel— y cualquier tercero que
-- se añada mañana heredaría la etiqueta sin que nadie tenga que acordarse.
-- De paso, esto NO necesita despliegue: en cuanto se aplica, las citas nuevas
-- salen marcadas aunque el código siga siendo el de ahora mismo.
--
-- El criterio es quién está autenticado al insertar, y ya está demostrado por
-- las políticas que hay:
--
--   · Web pública → `create_booking`, que es `security definer` porque `anon`
--     no puede escribir en `bookings` (política `owner_all_bookings`). El
--     visitante es anónimo: `auth.uid()` es NULL.
--   · Panel → INSERT directo con la sesión del dueño. Ese INSERT pasa el
--     `with check (salons.owner_id = auth.uid())` de `owner_all_bookings`, así
--     que si funciona —y funciona a diario— es que ahí `auth.uid()` ES el
--     dueño. No hay que fiarse de nada más.
--
-- Un cliente con cuenta (el magic link de /perfil) reservando en la web lleva
-- SU uid, que nunca es el del dueño: cae en 'cliente', que es lo correcto.
-- El «Entrar como» del superadmin monta la sesión del dueño, así que lo que
-- apunte desde ahí cuenta como 'panel'. También correcto: está haciendo de él.

alter table bookings add column if not exists source text;

comment on column bookings.source is
  'Quién dio de alta la cita: cliente (web pública) o panel (el dueño a mano). '
  'NULL en las anteriores a la migración 0032, donde no hay señal fiable.';

alter table bookings drop constraint if exists bookings_source_check;
alter table bookings add constraint bookings_source_check
  check (source is null or source in ('cliente', 'panel'));

create or replace function bookings_marcar_origen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Solo si viene sin poner: así un INSERT que quiera declararlo (una
  -- importación, una migración de datos) manda sobre la deducción.
  if new.source is null then
    new.source := case
      when auth.uid() is not null
           and auth.uid() = (select s.owner_id from salons s where s.id = new.salon_id)
        then 'panel'
      else 'cliente'
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_marcar_origen on bookings;
create trigger trg_bookings_marcar_origen
  before insert on bookings
  for each row execute function bookings_marcar_origen();

-- ── El interruptor, para poder desplegar antes de migrar ───────────────
--
-- `main` despliega solo al mergear, pero las migraciones se aplican a mano.
-- Sin esto, el código que pida `source` llegaría a producción antes que la
-- columna y tumbaría la consulta ENTERA de la agenda —no solo ese campo—,
-- que es la trampa de siempre con PostgREST. Con la clave `origen` la app
-- pregunta primero y pide la columna solo si existe.
create or replace function features_disponibles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clientes',       to_regclass('public.customers') is not null,
    'fidelizacion',   to_regclass('public.loyalty_programs') is not null,
    'productos',      to_regclass('public.products') is not null,
    'newsletter',     to_regclass('public.newsletter_campaigns') is not null,
    'resenas',        to_regclass('public.review_requests') is not null,
    'penalizaciones', to_regclass('public.penalty_programs') is not null,
    'push',           to_regclass('public.push_subscriptions') is not null,
    'recordatorios',  to_regclass('public.reminders') is not null,
    'premios',        to_regclass('public.loyalty_rewards') is not null,
    'cancelaciones',  exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'bookings'
                          and column_name = 'cancelled_at'
                      ),
    'origen',         exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'bookings'
                          and column_name = 'source'
                      )
  )
$$;

-- ── Lo viejo se queda sin marcar, a propósito ──────────────────────────
--
-- Aquí hubo un relleno del histórico y se quitó tras verlo en producción.
--
-- Se podía demostrar el origen de una parte: `create_booking` rechaza
-- teléfonos de menos de 9 dígitos desde la 0004, así que una cita con
-- teléfono corto no pudo nacer en la web; y el alta manual del panel nunca
-- manda `customer_email` —su formulario ni tiene ese campo—, así que un
-- email relleno solo puede venir de la web. Entre las dos reglas salían 30
-- de 41.
--
-- El problema no era la fiabilidad, era cómo se leía: quedaban unas citas
-- marcadas y otras en blanco sin que la diferencia significase nada para
-- quien mira la agenda —el blanco parecía «web» por omisión, cuando quería
-- decir «no consta»—. Un histórico a medias confunde más de lo que informa.
--
-- Así que las anteriores a esta migración se quedan todas en NULL y la
-- marca empieza a contar desde aquí, que es donde el trigger la pone bien
-- siempre. En unas semanas el histórico sin marcar ya no lo mira nadie.

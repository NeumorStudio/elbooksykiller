-- Quién canceló, cuándo, y cuántas veces lo hizo tarde.
--
-- La escalera de faltas solo cuenta plantones: quien no aparece suma. Pero
-- el cliente que cancela sistemáticamente al filo —dentro del margen, así
-- que sin romper ninguna regla— sale gratis y además es invisible: en su
-- ficha no aparece nada, y el dueño solo tiene la sensación de que "ese
-- siempre falla". Esto no castiga a nadie; solo deja el rastro para que se
-- pueda mirar.
--
-- El umbral son 2 horas. Por debajo de eso el hueco ya no se recoloca en la
-- práctica (el servicio más largo dura 1 h y nadie mira la web con una hora
-- de antelación), y por encima la cancelación es justo lo que queremos que
-- el cliente haga. Es deliberadamente más ancho que el margen para cancelar
-- online: si mañana ese margen cambia, esta medida sigue significando lo
-- mismo.

alter table bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_cancelled_by_check'
  ) then
    alter table bookings add constraint bookings_cancelled_by_check
      check (cancelled_by is null or cancelled_by in ('customer', 'salon'));
  end if;
end $$;

alter table customers
  add column if not exists late_cancellations int not null default 0;

-- ── El sello, venga la cancelación por donde venga ─────────────────────
--
-- En BEFORE y no en la app: cancelar se puede desde el enlace del cliente,
-- desde el panel del dueño y desde un UPDATE a mano en la base. Si la hora
-- la pusiera la app, la tercera vía dejaría filas sin fecha y el recuento
-- mentiría sin avisar.
create or replace function bookings_sellar_cancelacion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_sellar_cancelacion on bookings;
create trigger trg_bookings_sellar_cancelacion
  before update on bookings
  for each row execute function bookings_sellar_cancelacion();

-- ── El recuento ───────────────────────────────────────────────────────
--
-- Solo cuentan las del cliente: que el salón cancele una cita con media
-- hora de margen es problema del salón, no del cliente, y sumárselo a su
-- ficha sería acusarle de algo que no hizo. Por eso `cancelled_by` lo
-- escribe la app, que es la única que sabe quién apretó el botón; sin ese
-- dato no se cuenta nada.
create or replace function bookings_contar_cancelacion_tardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.cancelled_by = 'customer'
     and new.customer_id is not null
     and new.starts_at - coalesce(new.cancelled_at, now()) < interval '2 hours'
  then
    update customers
       set late_cancellations = late_cancellations + 1
     where id = new.customer_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_bookings_cancelacion_tardia on bookings;
create trigger trg_bookings_cancelacion_tardia
  after update on bookings
  for each row execute function bookings_contar_cancelacion_tardia();

-- ── El interruptor de siempre ─────────────────────────────────────────
--
-- Mismo patrón que el resto: la app pregunta qué existe en vez de suponerlo,
-- así que con esta migración sin aplicar todo sigue funcionando igual y al
-- aplicarla se enciende sola. Aquí se mira la columna, no una tabla nueva.
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
    'cancelaciones',  exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'bookings'
                          and column_name = 'cancelled_at'
                      )
  )
$$;

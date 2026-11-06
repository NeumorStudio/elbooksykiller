-- La cuota que cada salón paga a NeumorStudio.
--
-- Va en su propia tabla y no en `salons` a propósito: el dueño tiene UPDATE
-- sobre su fila de `salons` por REST, así que ahí podría regalarse un plan.
-- Aquí solo escribe `service_role`, desde el webhook de Stripe.
--
-- Una fila por salón. Stripe manda: esto es una copia de lo que dice él.

create table if not exists suscripciones (
  salon_id               uuid primary key references salons(id) on delete cascade,
  plan                   text not null check (plan in ('esencial', 'crecimiento', 'agenda_llena')),
  estado                 text not null,
  stripe_customer_id     text not null,
  stripe_subscription_id text not null unique,
  periodo_fin            timestamptz,
  cancela_al_final       boolean not null default false,
  actualizada_en         timestamptz not null default now()
);

comment on table suscripciones is
  'Copia de la suscripción de Stripe de cada salón. La escribe solo el webhook.';
comment on column suscripciones.estado is
  'Estado tal cual lo da Stripe: active, trialing, past_due, unpaid, canceled, incomplete...';

alter table suscripciones enable row level security;

revoke all on suscripciones from anon, authenticated;
grant select on suscripciones to authenticated;

create policy dueno_ve_su_suscripcion on suscripciones for select
  using (exists (
    select 1 from salons s where s.id = suscripciones.salon_id and s.owner_id = auth.uid()
  ));

-- Se añade `suscripciones` para que el código pueda desplegarse antes que esto.
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
    'trabajadores',   to_regclass('public.employee_access') is not null,
    'suscripciones',  to_regclass('public.suscripciones') is not null,
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
                      ),
    'permisos_equipo', exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'employee_access'
                          and column_name = 'apuntar_citas'
                      )
  )
$$;

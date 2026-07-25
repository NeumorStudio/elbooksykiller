-- Penalizaciones por no presentarse: escalera configurable por salón.
--
-- 1ª falta → aviso por email. A partir de `block_after` faltas → bloqueo de
-- la reserva online durante `block_days`. A partir de `ban_after` → veto
-- indefinido. Redención: cada cita completada limpia una falta y relaja el
-- castigo (quien vuelve y cumple se rehabilita solo), y el dueño puede
-- perdonar del todo desde Clientes.
--
-- Contadores en customers y no derivado de bookings: el perdón del dueño y
-- la redención necesitan poder "borrar" faltas sin tocar el histórico real.

create table penalty_programs (
  salon_id uuid primary key references salons(id) on delete cascade,
  active boolean not null default false,
  block_after int not null default 2 check (block_after between 1 and 10),
  block_days int not null default 15 check (block_days between 1 and 365),
  ban_after int not null default 3 check (ban_after between 2 and 20),
  check (ban_after > block_after),
  updated_at timestamptz not null default now()
);

alter table customers add column no_show_strikes int not null default 0;
alter table customers add column blocked_until timestamptz;
alter table customers add column banned boolean not null default false;

alter table penalty_programs enable row level security;

-- Solo el dueño ve y edita su escalera; la web pública no la anuncia y el
-- chequeo al reservar va con service role.
create policy owner_all_penalty on penalty_programs for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create or replace function features_disponibles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clientes',       to_regclass('public.customers') is not null,
    'fidelizacion',   to_regclass('public.loyalty_programs') is not null,
    'productos',      to_regclass('public.products') is not null,
    'newsletter',     to_regclass('public.newsletter_campaigns') is not null,
    'resenas',        to_regclass('public.review_requests') is not null,
    'penalizaciones', to_regclass('public.penalty_programs') is not null
  )
$$;

-- Tarjeta de fidelización: libro de sellos, no contador.
--
-- Con un contador y el umbral calculado al vuelo, si el dueño sube el
-- programa de 6 a 10 visitas, quien tenía 7 sellos los pierde. Con sellos
-- individuales lo ganado está ganado, y el canje congela qué se prometió.

create table loyalty_programs (
  salon_id uuid primary key references salons(id) on delete cascade,
  active boolean not null default false,
  required_visits int not null default 6 check (required_visits between 2 and 50),
  reward text not null default 'Corte gratis',
  updated_at timestamptz not null default now()
);

create table loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete set null,
  visits_consumed int not null,   -- congela el requisito de aquel momento
  reward_text text not null       -- congela el premio de aquel momento
);
create index redemptions_customer on loyalty_redemptions (customer_id);
create index redemptions_salon on loyalty_redemptions (salon_id);

create table loyalty_stamps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  -- UNIQUE = idempotencia: completar la misma cita dos veces (botón + cron)
  -- no puede dar dos sellos. Misma lección que la tabla reminders.
  booking_id uuid unique references bookings(id) on delete set null,
  earned_at timestamptz not null default now(),
  redemption_id uuid references loyalty_redemptions(id) on delete set null
);
create index stamps_disponibles on loyalty_stamps (customer_id) where redemption_id is null;
create index stamps_salon on loyalty_stamps (salon_id);

alter table loyalty_programs enable row level security;
alter table loyalty_redemptions enable row level security;
alter table loyalty_stamps enable row level security;

-- La configuración del programa no es PII: la web pública puede anunciarla.
create policy public_read_programs on loyalty_programs for select using (true);
create policy owner_all_programs on loyalty_programs for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create policy owner_all_stamps on loyalty_stamps for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));
create policy customer_read_own_stamps on loyalty_stamps for select
  using (exists (select 1 from customers c where c.id = customer_id and c.auth_user_id = auth.uid()));

create policy owner_all_redemptions on loyalty_redemptions for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));
create policy customer_read_own_redemptions on loyalty_redemptions for select
  using (exists (select 1 from customers c where c.id = customer_id and c.auth_user_id = auth.uid()));

-- ── El sello se gana al COMPLETAR, se retira si luego fue "no vino" ────
-- Trigger y no código de app: cubre el botón del panel, el cron de
-- autocompletado y cualquier vía futura. Lo canjeado nunca se retira.
create or replace function fidelizacion_por_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and new.customer_id is not null then
    if exists (select 1 from loyalty_programs lp where lp.salon_id = new.salon_id and lp.active) then
      insert into loyalty_stamps (customer_id, salon_id, booking_id)
      values (new.customer_id, new.salon_id, new.id)
      on conflict (booking_id) do nothing;
    end if;
  elsif new.status in ('no_show', 'cancelled') and old.status = 'completed' then
    delete from loyalty_stamps
    where booking_id = new.id and redemption_id is null;
  end if;
  return new;
end $$;

create trigger trg_fidelizacion_por_estado
  after update of status on bookings
  for each row execute function fidelizacion_por_estado();

-- ── Canje atómico ──────────────────────────────────────────────────────
-- FIFO: se consumen los sellos más antiguos. RPC porque son tres escrituras
-- que deben ser una sola cosa; PostgREST no da transacciones multi-petición.
create or replace function canjear_premio(p_customer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid; v_req int; v_reward text; v_disponibles int; v_redemption uuid;
begin
  -- Solo el dueño del salón de ese cliente puede canjear.
  select c.salon_id into v_salon
  from customers c join salons s on s.id = c.salon_id
  where c.id = p_customer and s.owner_id = auth.uid();
  if v_salon is null then raise exception 'not_authorized'; end if;

  select required_visits, reward into v_req, v_reward
  from loyalty_programs where salon_id = v_salon and active;
  if v_req is null then raise exception 'program_inactive'; end if;

  select count(*) into v_disponibles
  from loyalty_stamps where customer_id = p_customer and redemption_id is null;
  if v_disponibles < v_req then raise exception 'not_enough_stamps'; end if;

  insert into loyalty_redemptions (customer_id, salon_id, redeemed_by, visits_consumed, reward_text)
  values (p_customer, v_salon, auth.uid(), v_req, v_reward)
  returning id into v_redemption;

  update loyalty_stamps set redemption_id = v_redemption
  where id in (
    select id from loyalty_stamps
    where customer_id = p_customer and redemption_id is null
    order by earned_at asc
    limit v_req
  );

  return jsonb_build_object('redemption_id', v_redemption, 'reward', v_reward);
end $$;

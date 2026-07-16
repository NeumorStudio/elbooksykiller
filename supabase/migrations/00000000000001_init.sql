-- ElBooksyKiller: esquema inicial
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create table salons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  custom_domain text unique,
  phone text,
  address text,
  timezone text not null default 'Europe/Madrid',
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  duration_min int not null check (duration_min between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Horario semanal por empleado. Minutos desde medianoche (600 = 10:00).
-- Varias filas por día = turno partido (mañana/tarde).
create table working_hours (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6), -- 0 = domingo
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);

-- Vacaciones / ausencias que bloquean reservas
create table time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  service_id uuid not null references services(id) on delete restrict,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','cancelled','completed','no_show')),
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- La BD garantiza que no hay dos citas solapadas del mismo empleado
  constraint no_overlap exclude using gist (
    employee_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);

create index bookings_salon_time on bookings (salon_id, starts_at);
create index bookings_employee_time on bookings (employee_id, starts_at);

-- ============ RLS ============
alter table salons enable row level security;
alter table employees enable row level security;
alter table services enable row level security;
alter table working_hours enable row level security;
alter table time_off enable row level security;
alter table bookings enable row level security;

-- Lectura pública: lo que necesita la web de reservas (sin PII)
create policy public_read_salons on salons for select using (true);
create policy public_read_employees on employees for select using (true);
create policy public_read_services on services for select using (true);
create policy public_read_hours on working_hours for select using (true);

-- El dueño gestiona todo lo de su salón
create policy owner_all_salons on salons for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all_employees on employees for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create policy owner_all_services on services for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create policy owner_all_hours on working_hours for all
  using (exists (select 1 from employees e join salons s on s.id = e.salon_id
                 where e.id = employee_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from employees e join salons s on s.id = e.salon_id
                      where e.id = employee_id and s.owner_id = auth.uid()));

create policy owner_all_time_off on time_off for all
  using (exists (select 1 from employees e join salons s on s.id = e.salon_id
                 where e.id = employee_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from employees e join salons s on s.id = e.salon_id
                      where e.id = employee_id and s.owner_id = auth.uid()));

-- Bookings: sin acceso anónimo directo. El público reserva vía las funciones
-- RPC de abajo (security definer), que validan el hueco y no exponen PII.
-- El dueño ve y gestiona las de su salón.
create policy owner_all_bookings on bookings for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ============ RPC públicas ============

-- Huecos libres de un empleado para un servicio en un día (hora local del salón).
-- Devuelve solo timestamps: nada de PII aunque la llame el anon key.
create or replace function available_slots(
  p_employee uuid, p_service uuid, p_day date
) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, s.timezone as tz
    from employees e join salons s on s.id = e.salon_id
    where e.id = p_employee and e.active
  ),
  svc as (
    select duration_min from services where id = p_service and active
  ),
  slots as (
    select gs as slot_start,
           gs + make_interval(mins => svc.duration_min) as slot_end
    from emp, svc, working_hours wh,
    lateral generate_series(
      (p_day::timestamp + make_interval(mins => wh.start_min)) at time zone emp.tz,
      (p_day::timestamp + make_interval(mins => wh.end_min - svc.duration_min)) at time zone emp.tz,
      interval '15 minutes'
    ) gs
    where wh.employee_id = emp.id
      and wh.weekday = extract(dow from p_day)::int
  )
  select slot_start from slots
  where slot_start > now()
    and not exists (
      select 1 from bookings b
      where b.employee_id = p_employee and b.status <> 'cancelled'
        and tstzrange(b.starts_at, b.ends_at) && tstzrange(slot_start, slot_end)
    )
    and not exists (
      select 1 from time_off t
      where t.employee_id = p_employee
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(slot_start, slot_end)
    )
  order by 1
$$;

-- Crea una reserva validando que el hueco es exactamente uno de los ofrecidos
-- (cubre horario, ausencias, solapes y pasado). La constraint no_overlap es el
-- cinturón de seguridad ante carreras.
create or replace function create_booking(
  p_employee uuid, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_email text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid; v_tz text; v_dur int; v_id uuid;
begin
  select e.salon_id, s.timezone into v_salon, v_tz
  from employees e join salons s on s.id = e.salon_id
  where e.id = p_employee and e.active;
  if v_salon is null then raise exception 'employee_not_found'; end if;

  select duration_min into v_dur from services
  where id = p_service and salon_id = v_salon and active;
  if v_dur is null then raise exception 'service_not_found'; end if;

  if length(trim(p_name)) < 2 or length(trim(p_phone)) < 6 then
    raise exception 'invalid_customer';
  end if;

  if not exists (
    select 1
    from available_slots(p_employee, p_service, (p_start at time zone v_tz)::date) t(s)
    where t.s = p_start
  ) then
    raise exception 'slot_unavailable';
  end if;

  insert into bookings (salon_id, employee_id, service_id, customer_name,
                        customer_phone, customer_email, starts_at, ends_at, notes)
  values (v_salon, p_employee, p_service, trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), p_start,
          p_start + make_interval(mins => v_dur), p_notes)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'slot_unavailable';
end $$;

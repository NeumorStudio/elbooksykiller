-- Acceso de trabajadores: un peluquero entra desde su móvil y ve SUS citas.
--
-- Hasta aquí un profesional era una ficha (`employees`) sin cuenta: nombre,
-- horario y ausencias. Toda la seguridad del panel pregunta una sola cosa
-- —«¿eres el dueño de este salón?»— y eso no se toca. El trabajador entra
-- por un camino aparte y estrecho:
--
--   · `employee_access` une una ficha con una cuenta de Supabase Auth. Solo
--     se escribe por service role (la action del dueño, tras comprobar que
--     la ficha es suya). Sin políticas de escritura para `authenticated`:
--     ni el dueño ni el trabajador pueden fabricarse un vínculo por REST.
--   · El trabajador NO recibe ninguna política sobre `bookings`, `customers`
--     ni nada del salón. Lee y marca a través de tres RPC `security definer`
--     que devuelven solo lo suyo y solo las columnas que necesita en la
--     silla: hora, cliente, teléfono, servicio y nota. Ni email del cliente,
--     ni su ficha, ni el enlace público de la cita, ni la caja.
--   · Una ficha dada de baja o un salón bloqueado apagan el acceso solos:
--     las tres RPC lo comprueban, así que no hay que acordarse de revocar.
--
-- Nada de esto cambia lo que ve o puede hacer el dueño ni el superadmin.

create table if not exists employee_access (
  employee_id     uuid primary key references employees(id) on delete cascade,
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  email           text not null,
  created_at      timestamptz not null default now(),
  last_invited_at timestamptz
);

comment on table employee_access is
  'Qué cuenta de Auth entra como qué profesional. Solo la escribe service role.';

alter table employee_access enable row level security;

-- El dueño ve quién de su equipo tiene acceso (para pintarlo en Equipo).
drop policy if exists owner_select_employee_access on employee_access;
create policy owner_select_employee_access on employee_access
  for select to authenticated
  using (exists (
    select 1 from employees e join salons s on s.id = e.salon_id
    where e.id = employee_id and s.owner_id = auth.uid()
  ));

-- El trabajador ve su propia fila, y nada más.
drop policy if exists worker_select_own_access on employee_access;
create policy worker_select_own_access on employee_access
  for select to authenticated
  using (user_id = auth.uid());

-- Cinturón y tirante, igual que en la 0023: sin grant de escritura, un
-- INSERT/UPDATE/DELETE con la clave pública ni llega a evaluar políticas.
revoke all on employee_access from anon, authenticated;
grant select on employee_access to authenticated;

-- ── Quién soy en este salón ────────────────────────────────────────────
create or replace function mi_puesto()
returns table (
  employee_id   uuid,
  employee_name text,
  active        boolean,
  salon_id      uuid,
  salon_name    text,
  salon_slug    text,
  timezone      text,
  blocked       boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.active, s.id, s.name, s.slug, s.timezone, s.blocked
  from employee_access a
  join employees e on e.id = a.employee_id
  join salons s on s.id = e.salon_id
  where a.user_id = auth.uid()
  limit 1
$$;

revoke execute on function mi_puesto() from public, anon;
grant execute on function mi_puesto() to authenticated;

-- ── Mis citas ──────────────────────────────────────────────────────────
-- Solo las del profesional vinculado, sin canceladas, en una ventana de
-- como mucho 62 días para que nadie pueda volcar el histórico entero.
create or replace function mis_citas(p_desde timestamptz, p_hasta timestamptz)
returns table (
  id             uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text,
  customer_name  text,
  customer_phone text,
  notes          text,
  service_name   text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.starts_at, b.ends_at, b.status,
         b.customer_name, b.customer_phone, b.notes, sv.name
  from employee_access a
  join employees e on e.id = a.employee_id and e.active
  join salons s on s.id = e.salon_id and not s.blocked
  join bookings b on b.employee_id = e.id
  left join services sv on sv.id = b.service_id
  where a.user_id = auth.uid()
    and b.status <> 'cancelled'
    and b.starts_at >= p_desde
    and b.starts_at < p_hasta
    and p_hasta > p_desde
    and p_hasta - p_desde <= interval '62 days'
  order by b.starts_at
$$;

revoke execute on function mis_citas(timestamptz, timestamptz) from public, anon;
grant execute on function mis_citas(timestamptz, timestamptz) to authenticated;

-- ── Marcar asistencia ──────────────────────────────────────────────────
-- Lo único que escribe el trabajador. Solo el estado, solo en sus citas, y
-- «atendida» / «no vino» solo cuando la cita ya ha empezado (con media hora
-- de margen): marcar un no-show por error a una cita de la semana que viene
-- le pondría una falta al cliente. Volver a «confirmada» siempre se puede,
-- para deshacer un error con prisa. Los sellos de fidelidad salen solos del
-- trigger `fidelizacion_por_estado`, igual que cuando marca el dueño.
create or replace function marcar_mi_cita(p_booking uuid, p_status text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('confirmed', 'completed', 'no_show') then
    raise exception 'estado_invalido';
  end if;

  update bookings b
     set status = p_status
    from employee_access a, employees e, salons s
   where b.id = p_booking
     and a.user_id = auth.uid()
     and a.employee_id = b.employee_id
     and e.id = b.employee_id and e.active
     and s.id = b.salon_id and not s.blocked
     and b.status <> 'cancelled'
     and (p_status = 'confirmed' or b.starts_at <= now() + interval '30 minutes');

  return found;
end $$;

revoke execute on function marcar_mi_cita(uuid, text) from public, anon;
grant execute on function marcar_mi_cita(uuid, text) to authenticated;

-- ── El interruptor ─────────────────────────────────────────────────────
-- Mismo patrón que la 0032: el código puede llegar a producción antes que
-- esta migración, y con la clave `trabajadores` a false la app ni pide la
-- tabla ni enseña nada nuevo.
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

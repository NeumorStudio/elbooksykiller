-- Permisos de trabajador: el dueño decide, ficha a ficha, si un profesional
-- ve la agenda de todo el equipo y si puede apuntar, mover y cancelar citas.
--
-- Encima de la 0033, sin tocar su modelo: el trabajador sigue sin ninguna
-- política sobre `bookings`. Todo pasa por RPC `security definer` que miran
-- sus dos interruptores en cada llamada, así que apagarlos surte efecto en
-- la siguiente petición, sin cerrar sesiones ni esperar a nada.
--
--   · ver_agenda_equipo → ve las citas de todos (hora, cliente y servicio)
--     para saber qué huecos quedan. El teléfono y el enlace de las citas de
--     los compañeros solo si además puede apuntar: sin poder tocar la cita,
--     no tiene a quién llamar.
--   · apuntar_citas → crea, mueve y cancela. En su propia agenda, o en la
--     de todos si además la ve: no se gestiona lo que no se ve.
--
-- Lo que no cambia: precios, servicios, caja, clientes, fidelización y
-- newsletter son solo del dueño, sin interruptor. Y una cita pagada online
-- solo la cancela el dueño, porque cancelarla es devolver el dinero.
--
-- Arrancan apagados: dar acceso a alguien no le da permisos por sorpresa.

alter table employee_access
  add column if not exists ver_agenda_equipo boolean not null default false,
  add column if not exists apuntar_citas     boolean not null default false;

comment on column employee_access.ver_agenda_equipo is
  'Ve las citas de todo el equipo. Lo enciende el dueño en Equipo.';
comment on column employee_access.apuntar_citas is
  'Crea, mueve y cancela citas (las suyas, o las de todos si ve la agenda del equipo).';

-- ── Quién soy, ahora con mis permisos ──────────────────────────────────
-- Cambia la forma del resultado, y eso en Postgres no se hace con
-- `create or replace`: hay que tirarla y crearla. Va todo en la misma
-- transacción, así que no hay instante en que no exista.
drop function if exists mi_puesto();
create function mi_puesto()
returns table (
  employee_id       uuid,
  employee_name     text,
  active            boolean,
  salon_id          uuid,
  salon_name        text,
  salon_slug        text,
  timezone          text,
  blocked           boolean,
  ver_agenda_equipo boolean,
  apuntar_citas     boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.active, s.id, s.name, s.slug, s.timezone, s.blocked,
         a.ver_agenda_equipo, a.apuntar_citas
  from employee_access a
  join employees e on e.id = a.employee_id
  join salons s on s.id = e.salon_id
  where a.user_id = auth.uid()
  limit 1
$$;

revoke execute on function mi_puesto() from public, anon;
grant execute on function mi_puesto() to authenticated;

-- ── La agenda que le toca ver ──────────────────────────────────────────
-- Sus citas siempre; las de todos si tiene `ver_agenda_equipo`. Las
-- canceladas fuera, igual que en la agenda del dueño. Ventana de como mucho
-- 125 días —la del dueño va del día 1 del mes a +90— y tope de filas, para
-- que nadie vuelque el histórico.
create or replace function agenda_equipo(p_desde timestamptz, p_hasta timestamptz)
returns table (
  id             uuid,
  employee_id    uuid,
  employee_name  text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text,
  customer_name  text,
  customer_phone text,
  public_token   uuid,
  payment_status text,
  service_name   text,
  price_cents    int,
  source         text
)
language sql stable security definer set search_path = public as $$
  with yo as (
    select a.employee_id, e.salon_id, a.ver_agenda_equipo, a.apuntar_citas
    from employee_access a
    join employees e on e.id = a.employee_id and e.active
    join salons s on s.id = e.salon_id and not s.blocked
    where a.user_id = auth.uid()
  )
  select b.id, b.employee_id, emp.name, b.starts_at, b.ends_at, b.status,
         b.customer_name,
         case when b.employee_id = yo.employee_id or yo.apuntar_citas
              then b.customer_phone end,
         -- El enlace público deja cancelar la cita: solo a quien puede
         -- gestionarla, que es quien lo necesita para mandarlo por WhatsApp.
         case when yo.apuntar_citas then b.public_token end,
         b.payment_status, sv.name, sv.price_cents, b.source
  from yo
  join bookings b on b.salon_id = yo.salon_id
  join employees emp on emp.id = b.employee_id
  left join services sv on sv.id = b.service_id
  where (b.employee_id = yo.employee_id or yo.ver_agenda_equipo)
    and b.status in ('confirmed', 'completed', 'no_show')
    and b.starts_at >= p_desde
    and b.starts_at < p_hasta
    and p_hasta > p_desde
    and p_hasta - p_desde <= interval '125 days'
  order by b.starts_at
  limit 600
$$;

revoke execute on function agenda_equipo(timestamptz, timestamptz) from public, anon;
grant execute on function agenda_equipo(timestamptz, timestamptz) to authenticated;

-- ── Apuntar una cita ───────────────────────────────────────────────────
-- Lo mismo que el alta a mano del dueño: sin validar contra el horario
-- (el que entra a las 20:55 también cuenta), con el solape protegido por
-- `no_overlap` y el tope de citas por teléfono de la 0015 actuando igual.
-- `source` va puesto a 'panel' a mano: el trigger de la 0032 deduce el
-- origen de si quien inserta es el dueño, y aquí no lo es.
create or replace function apuntar_cita(
  p_employee       uuid,
  p_service        uuid,
  p_starts_at      timestamptz,
  p_customer_name  text,
  p_customer_phone text
)
returns table (cita_id uuid, cita_token uuid, cita_fin timestamptz, servicio text)
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid; v_salon uuid; v_ver boolean; v_apuntar boolean;
  v_dur int; v_serv text; v_nombre text; v_tel text;
  v_id uuid; v_token uuid; v_fin timestamptz;
begin
  select a.employee_id, e.salon_id, a.ver_agenda_equipo, a.apuntar_citas
    into v_emp, v_salon, v_ver, v_apuntar
  from employee_access a
  join employees e on e.id = a.employee_id and e.active
  join salons s on s.id = e.salon_id and not s.blocked
  where a.user_id = auth.uid();
  if v_emp is null or not v_apuntar then raise exception 'sin_permiso'; end if;
  if p_employee is distinct from v_emp and not v_ver then raise exception 'sin_permiso'; end if;

  if not exists (select 1 from employees where id = p_employee and salon_id = v_salon and active) then
    raise exception 'profesional_invalido';
  end if;

  select duration_min, name into v_dur, v_serv
  from services where id = p_service and salon_id = v_salon and active;
  if v_dur is null then raise exception 'servicio_invalido'; end if;

  v_nombre := btrim(coalesce(p_customer_name, ''));
  if length(v_nombre) < 2 or length(v_nombre) > 100 then raise exception 'nombre_invalido'; end if;

  v_tel := nullif(btrim(coalesce(p_customer_phone, '')), '');
  if v_tel is not null and normalizar_tel(v_tel) is null then raise exception 'telefono_invalido'; end if;

  -- El mismo día vale (el corte ya hecho que nadie apuntó); más atrás no.
  if p_starts_at is null
     or p_starts_at < now() - interval '1 day'
     or p_starts_at > now() + interval '366 days' then
    raise exception 'fecha_invalida';
  end if;

  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone,
                        starts_at, ends_at, status, source)
  values (v_salon, p_employee, p_service, v_nombre, coalesce(v_tel, '—'),
          p_starts_at, p_starts_at + make_interval(mins => v_dur), 'confirmed', 'panel')
  returning bookings.id, bookings.public_token, bookings.ends_at into v_id, v_token, v_fin;

  return query select v_id, v_token, v_fin, v_serv;
end $$;

revoke execute on function apuntar_cita(uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function apuntar_cita(uuid, uuid, timestamptz, text, text) to authenticated;

-- ── Mover una cita ─────────────────────────────────────────────────────
-- Devuelve la hora que tenía, que es lo que necesita el aviso al cliente
-- («antes era…, ahora es…»). Solo citas activas y que aún no han empezado:
-- cambiar de hora una cita pasada es reescribir el historial.
create or replace function mover_cita_equipo(p_booking uuid, p_starts_at timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid; v_salon uuid; v_ver boolean; v_apuntar boolean;
  v_bemp uuid; v_status text; v_old timestamptz; v_dur int;
begin
  select a.employee_id, e.salon_id, a.ver_agenda_equipo, a.apuntar_citas
    into v_emp, v_salon, v_ver, v_apuntar
  from employee_access a
  join employees e on e.id = a.employee_id and e.active
  join salons s on s.id = e.salon_id and not s.blocked
  where a.user_id = auth.uid();
  if v_emp is null or not v_apuntar then raise exception 'sin_permiso'; end if;

  select b.employee_id, b.status, b.starts_at, sv.duration_min
    into v_bemp, v_status, v_old, v_dur
  from bookings b join services sv on sv.id = b.service_id
  where b.id = p_booking and b.salon_id = v_salon
  for update of b;
  if v_old is null then raise exception 'no_existe'; end if;
  if v_bemp is distinct from v_emp and not v_ver then raise exception 'sin_permiso'; end if;
  if v_status not in ('confirmed', 'pending_payment') then raise exception 'no_activa'; end if;
  if v_old < now() then raise exception 'ya_empezada'; end if;

  if p_starts_at is null
     or p_starts_at < now() - interval '1 day'
     or p_starts_at > now() + interval '366 days' then
    raise exception 'fecha_invalida';
  end if;
  if p_starts_at = v_old then raise exception 'misma_hora'; end if;

  update bookings
     set starts_at = p_starts_at,
         ends_at   = p_starts_at + make_interval(mins => v_dur)
   where id = p_booking;

  return v_old;
end $$;

revoke execute on function mover_cita_equipo(uuid, timestamptz) from public, anon;
grant execute on function mover_cita_equipo(uuid, timestamptz) to authenticated;

-- ── Cancelar una cita ──────────────────────────────────────────────────
-- Cuenta como cancelada por el salón (`cancelled_by = 'salon'`), igual que
-- cuando cancela el dueño: nunca le pone falta al cliente. Las pagadas
-- online quedan fuera porque cancelarlas es devolver el dinero, y eso lo
-- decide el dueño.
create or replace function cancelar_cita_equipo(p_booking uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid; v_salon uuid; v_ver boolean; v_apuntar boolean;
  v_bemp uuid; v_status text; v_pago text; v_ini timestamptz;
begin
  select a.employee_id, e.salon_id, a.ver_agenda_equipo, a.apuntar_citas
    into v_emp, v_salon, v_ver, v_apuntar
  from employee_access a
  join employees e on e.id = a.employee_id and e.active
  join salons s on s.id = e.salon_id and not s.blocked
  where a.user_id = auth.uid();
  if v_emp is null or not v_apuntar then raise exception 'sin_permiso'; end if;

  select b.employee_id, b.status, b.payment_status, b.starts_at
    into v_bemp, v_status, v_pago, v_ini
  from bookings b
  where b.id = p_booking and b.salon_id = v_salon
  for update;
  if v_ini is null then raise exception 'no_existe'; end if;
  if v_bemp is distinct from v_emp and not v_ver then raise exception 'sin_permiso'; end if;
  if v_status not in ('confirmed', 'pending_payment') then raise exception 'no_activa'; end if;
  if v_ini < now() then raise exception 'ya_empezada'; end if;
  if v_pago = 'paid' then raise exception 'pagada'; end if;

  update bookings set status = 'cancelled', cancelled_by = 'salon' where id = p_booking;
  return true;
end $$;

revoke execute on function cancelar_cita_equipo(uuid) from public, anon;
grant execute on function cancelar_cita_equipo(uuid) to authenticated;

-- ── El interruptor ─────────────────────────────────────────────────────
-- Igual que siempre: el código puede llegar antes que la migración, y con
-- `permisos_equipo` a false la app ni pide las columnas nuevas.
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
                      ),
    'permisos_equipo', exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'employee_access'
                          and column_name = 'apuntar_citas'
                      )
  )
$$;

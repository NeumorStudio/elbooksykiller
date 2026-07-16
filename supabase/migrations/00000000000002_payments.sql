-- Pagos con Stripe Connect: cada salón cobra en su propia cuenta.
alter table salons
  add column stripe_account_id text,
  add column charges_enabled boolean not null default false;

-- Qué se cobra al reservar cada servicio.
alter table services
  add column payment_type text not null default 'none'
    check (payment_type in ('none', 'deposit', 'full')),
  add column deposit_cents int
    check (deposit_cents is null or deposit_cents > 0);

alter table bookings
  add column payment_status text not null default 'none'
    check (payment_status in ('none', 'pending', 'paid')),
  add column stripe_session_id text;

-- Reserva a la espera de pago: bloquea el hueco (la exclusion constraint ya
-- excluye solo 'cancelled') hasta que el pago llega o caduca.
alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('confirmed', 'pending_payment', 'cancelled', 'completed', 'no_show'));

-- create_booking acepta pago pendiente y devuelve la reserva creada.
-- La firma cambia: hay que tirar la versión anterior o PostgREST ve dos
-- funciones ambiguas y devuelve 300.
drop function if exists create_booking(uuid, uuid, timestamptz, text, text, text, text);
create or replace function create_booking(
  p_employee uuid, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_email text default null, p_notes text default null,
  p_pending_payment boolean default false
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

  -- caduca reservas cuyo pago nunca llegó, para liberar sus huecos
  update bookings set status = 'cancelled'
  where employee_id = p_employee and status = 'pending_payment'
    and created_at < now() - interval '40 minutes';

  if not exists (
    select 1
    from available_slots(p_employee, p_service, (p_start at time zone v_tz)::date) t(s)
    where t.s = p_start
  ) then
    raise exception 'slot_unavailable';
  end if;

  insert into bookings (salon_id, employee_id, service_id, customer_name,
                        customer_phone, customer_email, starts_at, ends_at, notes,
                        status, payment_status)
  values (v_salon, p_employee, p_service, trim(p_name), trim(p_phone),
          nullif(trim(p_email), ''), p_start,
          p_start + make_interval(mins => v_dur), p_notes,
          case when p_pending_payment then 'pending_payment' else 'confirmed' end,
          case when p_pending_payment then 'pending' else 'none' end)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'slot_unavailable';
end $$;

-- Teléfono real: mínimo 9 dígitos (quitando espacios, guiones, etc.).
-- Misma firma → create or replace sustituye sin duplicar.
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

  if length(trim(p_name)) < 2
     or length(regexp_replace(p_phone, '\D', '', 'g')) < 9 then
    raise exception 'invalid_customer';
  end if;

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

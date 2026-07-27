-- Rejilla de 30 minutos en vez de 15.
--
-- Solo cambia el paso del generate_series en las dos funciones de huecos. La
-- validación al reservar no se toca: create_booking() comprueba el hueco
-- contra available_slots(), así que la rejilla nueva se aplica sola también
-- en servidor y nadie puede colar un :15 por RPC.
--
-- La rejilla sigue anclada a la apertura, no al reloj: un salón que abre a
-- las 9:00 ofrece 9:00, 9:30…; uno que abra a las 9:20 ofrecerá 9:20, 9:50…
-- Es el comportamiento que ya había, solo que con el paso doblado.

create or replace function available_slots(p_employee uuid, p_service uuid, p_day date)
returns setof timestamptz
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
      interval '30 minutes'
    ) gs
    where wh.employee_id = emp.id
      and wh.weekday = extract(dow from p_day)::int
  )
  select distinct slot_start from slots
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

-- Igual para el bloque combinado. Aquí sigue valiendo lo de la migración 17:
-- solo el PRIMER servicio cae en la rejilla; los siguientes empiezan cuando
-- acaba el anterior, y con servicios de 20 o 25 minutos eso queda fuera de
-- ella. Por eso el bloque entero se comprueba de una vez y no encadenando
-- llamadas a available_slots().
create or replace function available_slots_combo(
  p_employee uuid, p_services uuid[], p_day date
) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, s.timezone as tz
    from employees e join salons s on s.id = e.salon_id
    where e.id = p_employee and e.active
  ),
  total as (
    select sum(sv.duration_min)::int as dur
    from unnest(p_services) as pedido(id)
    join services sv on sv.id = pedido.id and sv.active
  ),
  slots as (
    select gs as slot_start,
           gs + make_interval(mins => total.dur) as slot_end
    from emp, total, working_hours wh,
    lateral generate_series(
      (p_day::timestamp + make_interval(mins => wh.start_min)) at time zone emp.tz,
      (p_day::timestamp + make_interval(mins => wh.end_min - total.dur)) at time zone emp.tz,
      interval '30 minutes'
    ) gs
    where wh.employee_id = emp.id
      and wh.weekday = extract(dow from p_day)::int
      and total.dur is not null
  )
  select distinct slot_start from slots
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

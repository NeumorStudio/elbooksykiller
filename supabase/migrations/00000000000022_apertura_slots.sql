-- `opens_at` también en servidor.
--
-- La 0019 añadió la fecha de apertura y la web la respeta: el widget arranca
-- la ventana de 14 días el día que abre. Pero eso es solo el cliente. El RPC
-- es público, y create_booking() valida el hueco contra available_slots(),
-- que no sabía nada de opens_at: llamándolo a mano se podía reservar para
-- pasado mañana en un salón que abre en dos semanas. Nadie lo ha hecho, pero
-- es una reserva que el salón no puede atender y un cliente en la puerta.
--
-- El filtro va aquí, en las dos funciones de huecos, y no en create_booking:
-- así la validación de reserva lo hereda sola y no hay dos sitios que puedan
-- discrepar.
--
-- La comparación es date >= date en la zona del salón, igual que el resto de
-- la agenda. `opens_at` NULL = ya está abierto, y la fecha se ignora sola en
-- cuanto pasa: el día de la apertura ya cumple `p_day >= opens_at`.

create or replace function available_slots(p_employee uuid, p_service uuid, p_day date)
returns setof timestamptz
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, s.timezone as tz, s.opens_at
    from employees e join salons s on s.id = e.salon_id
    where e.id = p_employee and e.active
      and (s.opens_at is null or p_day >= s.opens_at)
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

create or replace function available_slots_combo(
  p_employee uuid, p_services uuid[], p_day date
) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, s.timezone as tz, s.opens_at
    from employees e join salons s on s.id = e.salon_id
    where e.id = p_employee and e.active
      and (s.opens_at is null or p_day >= s.opens_at)
  ),
  -- Duración total. El join contra el array cuenta los repetidos: dos
  -- cortes de niño son dos servicios, no uno.
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

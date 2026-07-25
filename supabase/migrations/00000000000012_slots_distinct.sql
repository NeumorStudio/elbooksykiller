-- Huecos sin duplicados.
--
-- Recuperada del esquema de producción: se aplicó a mano y nunca llegó al
-- repo, así que un entorno nuevo se montaba sin ella. Con dos tramos de
-- horario que se solapan (mañana y tarde mal cortadas, o dos filas del
-- mismo día), el generate_series producía la misma hora dos veces y el
-- widget pintaba huecos repetidos: `distinct` los colapsa.
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
      interval '15 minutes'
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

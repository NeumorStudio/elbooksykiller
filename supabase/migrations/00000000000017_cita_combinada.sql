-- Cita combinada: varios servicios seguidos, en la misma reserva.
--
-- El caso real es el padre que viene a cortarse y trae al niño. Hoy tiene
-- que reservar dos veces y rezar para que le den huecos pegados: si entre
-- medias se cuela otro cliente, se queda esperando media hora con el crío.
-- Peor todavía, el segundo hueco puede estar ya cogido y no enterarse hasta
-- después de confirmar el primero.
--
-- Dos funciones nuevas; el esquema no se toca. Cada servicio sigue siendo su
-- propia fila en `bookings` —el salón las ve seguidas en la agenda, cobra
-- por separado y puede cancelar una sin tocar la otra—, pero se crean todas
-- o ninguna.

-- ── Huecos donde cabe el bloque entero ────────────────────────────────
--
-- No vale con mirar si cabe el primer servicio: hay que comprobar el bloque
-- completo, o se ofrecen horas en las que el niño se queda fuera del cierre.
--
-- Ojo con el detalle que obliga a escribir esto y no encadenar dos llamadas
-- a available_slots(): solo el PRIMER servicio empieza en la rejilla de 15
-- minutos. El segundo empieza cuando acaba el primero, y con servicios de
-- 20 o 25 minutos —que los hay— eso cae fuera de la rejilla. Encadenar
-- huecos sueltos habría funcionado en un salón y fallado en el de al lado.
create or replace function available_slots_combo(
  p_employee uuid, p_services uuid[], p_day date
) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, s.timezone as tz
    from employees e join salons s on s.id = e.salon_id
    where e.id = p_employee and e.active
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
      interval '15 minutes'
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

-- ── Crear el bloque, todo o nada ──────────────────────────────────────
--
-- La primera cita pasa por create_booking_v2 para no duplicar nada de lo que
-- ya hace bien: validación, ficha del cliente, consentimiento de marketing,
-- productos apartados y token público. Las siguientes se insertan directas,
-- porque empiezan fuera de la rejilla y create_booking las rechazaría — y
-- ya no hace falta validarlas: el bloque completo se ha comprobado arriba.
--
-- Ser una sola función es lo que da el "todo o nada": una excepción en la
-- tercera cita deshace también la primera. Con dos llamadas desde la app,
-- el padre se quedaba con su cita hecha y la del niño no.
create or replace function create_booking_combo(
  p_employee uuid, p_services uuid[], p_start timestamptz,
  p_name text, p_phone text, p_email text default null, p_notes text default null,
  p_pending_payment boolean default false,
  p_marketing boolean default false,
  p_products jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid; v_tz text; v_res jsonb; v_cursor timestamptz; v_dur int;
  v_n int := coalesce(array_length(p_services, 1), 0);
  i int;
begin
  if v_n = 0 then raise exception 'service_not_found'; end if;

  select e.salon_id, s.timezone into v_salon, v_tz
  from employees e join salons s on s.id = e.salon_id
  where e.id = p_employee and e.active;
  if v_salon is null then raise exception 'employee_not_found'; end if;

  if not exists (
    select 1
    from available_slots_combo(p_employee, p_services, (p_start at time zone v_tz)::date) t(s)
    where t.s = p_start
  ) then
    raise exception 'slot_unavailable';
  end if;

  v_res := create_booking_v2(p_employee, p_services[1], p_start, p_name, p_phone,
                             p_email, p_notes, p_pending_payment, p_marketing, p_products);

  select duration_min into v_dur from services
  where id = p_services[1] and salon_id = v_salon and active;
  v_cursor := p_start + make_interval(mins => v_dur);

  for i in 2 .. v_n loop
    select duration_min into v_dur from services
    where id = p_services[i] and salon_id = v_salon and active;
    if v_dur is null then raise exception 'service_not_found'; end if;

    -- La nota deja rastro en la agenda: quien la mire tiene que entender de
    -- un vistazo por qué hay dos citas pegadas con el mismo teléfono.
    insert into bookings (salon_id, employee_id, service_id, customer_name,
                          customer_phone, customer_email, starts_at, ends_at,
                          notes, status)
    values (v_salon, p_employee, p_services[i], trim(p_name), trim(p_phone),
            nullif(trim(p_email), ''), v_cursor,
            v_cursor + make_interval(mins => v_dur),
            'Cita combinada — va seguida de la anterior',
            case when p_pending_payment then 'pending_payment' else 'confirmed' end);

    v_cursor := v_cursor + make_interval(mins => v_dur);
  end loop;

  return v_res || jsonb_build_object('citas', v_n);
exception when exclusion_violation then
  raise exception 'slot_unavailable';
end $$;

-- Las llama el widget con la clave anónima, igual que create_booking_v2.
grant execute on function available_slots_combo(uuid, uuid[], date) to anon, authenticated;
grant execute on function create_booking_combo(uuid, uuid[], timestamptz, text, text, text, text, boolean, boolean, jsonb) to anon, authenticated;

-- 0038 · La agenda del trabajador, sin el tope de 600 citas
--
-- `agenda_equipo` (0034) devolvía como mucho 600 filas, ordenadas por fecha
-- desde el día 1 del mes. En un salón con 20-25 citas al día eso se agota
-- antes de llegar a hoy, y las que quedan fuera salen como huecos libres:
-- el trabajador intenta apuntar ahí y la base lo rechaza por solape. Es el
-- mismo fallo que tenía la agenda del dueño con su tope de 400.
--
-- La ventana ya está acotada a 125 días, que es lo que impide volcar el
-- histórico. El tope se queda solo como freno y pasa a 10000, muy por encima
-- de lo que cabe en 125 días de cualquier salón. El panel lo pide por tandas
-- de 1000 (lo que deja PostgREST por respuesta), ordenando por fecha e id;
-- por eso el `order by` lleva también el id, para que las tandas no se
-- solapen ni dejen huecos.
--
-- Misma firma y mismo cuerpo: solo cambian el `order by` y el `limit`.
-- Es la 0038 y no la 0037 porque main ya tiene una 0037 (newsletter).

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
  order by b.starts_at, b.id
  limit 10000
$$;

revoke execute on function agenda_equipo(timestamptz, timestamptz) from public, anon;
grant execute on function agenda_equipo(timestamptz, timestamptz) to authenticated;

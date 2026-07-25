-- Endurecido previo a producción (auditoría de seguridad).

-- ── 1. El email de una ficha no se pisa desde una reserva ──────────────
-- El trigger hacía `email = coalesce(excluded.email, customers.email)`:
-- quien supiera un teléfono podía sobrescribir el email de esa ficha con el
-- suyo y luego reclamarla al entrar con magic link. Ahora el email solo se
-- fija cuando la ficha aún no tiene ninguno, así que coincidir con un email
-- verificado sí prueba propiedad. El nombre sí se refresca: es cosmético.
create or replace function bookings_vincular_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tel text;
begin
  v_tel := normalizar_tel(new.customer_phone);
  if v_tel is null then
    return new;  -- walk-in sin teléfono real: la cita queda sin cliente
  end if;

  insert into customers (salon_id, phone, name, email)
  values (new.salon_id, v_tel, trim(new.customer_name), nullif(trim(coalesce(new.customer_email, '')), ''))
  on conflict (salon_id, phone) do update
    set name = excluded.name,
        email = coalesce(customers.email, excluded.email)
  returning id into new.customer_id;

  return new;
end $$;

-- ── 2. Tope de citas futuras por teléfono ──────────────────────────────
-- Las RPC de reserva son llamables por `anon` con la clave pública: sin
-- tope, un bucle de curl llena la agenda de cualquier salón. Cuatro citas
-- futuras vivas por teléfono y salón cubre de sobra el uso real (familia
-- entera con el mismo móvil) y corta el abuso automatizado.
create or replace function bookings_tope_futuras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tel text;
  v_n int;
begin
  v_tel := normalizar_tel(new.customer_phone);
  if v_tel is null then
    return new;
  end if;
  select count(*) into v_n
  from bookings b
  where b.salon_id = new.salon_id
    and normalizar_tel(b.customer_phone) = v_tel
    and b.starts_at > now()
    and b.status in ('confirmed', 'pending_payment');
  if v_n >= 4 then
    raise exception 'demasiadas_reservas';
  end if;
  return new;
end $$;

create trigger trg_bookings_tope_futuras
  before insert on bookings
  for each row execute function bookings_tope_futuras();

-- ── 3. Higiene de funciones ────────────────────────────────────────────
-- search_path fijo (aviso del linter) y sin EXECUTE para lo que solo debe
-- dispararse desde un trigger.
create or replace function normalizar_tel(p_tel text) returns text
language sql immutable strict set search_path = public as $$
  select case
    when trim(p_tel) like '+%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) between 9 and 15
      then '+' || regexp_replace(p_tel, '\D', '', 'g')
    when regexp_replace(p_tel, '\D', '', 'g') like '0034%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) = 13
      then '+' || substr(regexp_replace(p_tel, '\D', '', 'g'), 3)
    when regexp_replace(p_tel, '\D', '', 'g') like '34%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) = 11
      then '+' || regexp_replace(p_tel, '\D', '', 'g')
    -- nacional español de 9 dígitos
    when length(regexp_replace(p_tel, '\D', '', 'g')) = 9
      then '+34' || regexp_replace(p_tel, '\D', '', 'g')
    else null
  end
$$;

revoke execute on function bookings_vincular_cliente() from public, anon, authenticated;
revoke execute on function bookings_tope_futuras() from public, anon, authenticated;
revoke execute on function fidelizacion_por_estado() from public, anon, authenticated;

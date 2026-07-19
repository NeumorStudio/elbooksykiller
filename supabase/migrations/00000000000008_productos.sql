-- Productos del salón, reservables junto a la cita (sin pago aún: el pago
-- y la recogida llegarán después; hoy "reservado" significa "apartado").

create table products (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  description text,
  price_cents int not null check (price_cents >= 0),
  -- null = no se controla stock. No se descuenta al reservar: una reserva
  -- no es una venta y el cliente puede no venir. Descontar llega con el pago.
  stock int check (stock is null or stock >= 0),
  image_path text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index products_salon on products (salon_id);

create table booking_products (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  -- restrict: el "borrado" de producto en el panel es lógico (active=false).
  -- Misma lección que los servicios del piloto y sus 904 reservas.
  product_id uuid not null references products(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0),
  unit_price_cents int not null,  -- congelado al reservar: lo pactado no cambia
  created_at timestamptz not null default now(),
  unique (booking_id, product_id)
);
create index booking_products_product on booking_products (product_id);

alter table products enable row level security;
alter table booking_products enable row level security;

-- La web pública enseña el catálogo activo; el inactivo no existe para nadie
-- más que el dueño.
create policy public_read_products on products for select using (active);
create policy owner_all_products on products for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- Sin política para anon: las líneas de reserva llevan datos de compra del
-- cliente. Solo el dueño (y el servidor con token) las ven.
create policy owner_all_booking_products on booking_products for all
  using (exists (select 1 from bookings b join salons s on s.id = b.salon_id
                 where b.id = booking_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from bookings b join salons s on s.id = b.salon_id
                      where b.id = booking_id and s.owner_id = auth.uid()));

-- ── Reserva v2: cita + consentimiento + productos, en una transacción ──
--
-- Función NUEVA en vez de cambiar create_booking: el código viejo desplegado
-- sigue llamando a la vieja (devuelve uuid) y el nuevo a esta (devuelve
-- jsonb). Ningún orden de deploy/migración rompe nada.
--
-- La reserva es sagrada: si un producto llegó inactivo o desapareció entre
-- pintar la pantalla y pulsar confirmar, NO se cae la cita — se omite el
-- producto y se devuelve en `omitidos` para avisar en la confirmación.
create or replace function create_booking_v2(
  p_employee uuid, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_email text default null, p_notes text default null,
  p_pending_payment boolean default false,
  p_marketing boolean default false,
  p_products jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_salon uuid; v_customer uuid; v_token uuid;
  v_item jsonb; v_prod record; v_qty int;
  v_omitidos uuid[] := '{}';
begin
  -- Toda la validación (horario, solapes, teléfono, caducidad de pagos)
  -- vive en create_booking; no se duplica.
  v_id := create_booking(p_employee, p_service, p_start, p_name, p_phone,
                         p_email, p_notes, p_pending_payment);

  select salon_id, customer_id, public_token into v_salon, v_customer, v_token
  from bookings where id = v_id;

  -- Consentimiento: solo se ENCIENDE aquí, nunca se apaga (apagar es de la
  -- baja). Con fecha y origen: es la prueba que exige el art. 21 LSSI-CE.
  if p_marketing and v_customer is not null then
    update customers
    set marketing_opt_in = true,
        marketing_opt_in_at = now(),
        marketing_opt_in_source = 'casilla en la reserva web'
    where id = v_customer and not marketing_opt_in;
  end if;

  if p_products is not null then
    for v_item in select * from jsonb_array_elements(p_products) loop
      v_qty := greatest(coalesce((v_item->>'qty')::int, 1), 1);
      select id, price_cents into v_prod
      from products
      where id = (v_item->>'id')::uuid and salon_id = v_salon and active;
      if v_prod.id is null then
        v_omitidos := v_omitidos || (v_item->>'id')::uuid;
      else
        insert into booking_products (booking_id, product_id, quantity, unit_price_cents)
        values (v_id, v_prod.id, v_qty, v_prod.price_cents)
        on conflict (booking_id, product_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'booking_id', v_id,
    'public_token', v_token,
    'omitidos', to_jsonb(v_omitidos)
  );
end $$;

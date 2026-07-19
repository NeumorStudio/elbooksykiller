-- Clientes como entidad propia + URL permanente de cita.
--
-- Hasta ahora un "cliente" era un customer_name + customer_phone repetido en
-- bookings. Sin entidad no hay fidelización, ni newsletter, ni reseñas.
--
-- Decisión de producto, no solo de esquema: unique (salon_id, phone) — el
-- cliente pertenece a UN salón. Un perfil global convertiría a la plataforma
-- en responsable del tratamiento (régimen RGPD mucho más pesado) y es
-- exactamente lo que hace GoBarber: meter a los clientes del salón en un
-- directorio con su competencia al lado.

-- ── Normalizador canónico de teléfono (E.164) ──────────────────────────
-- Espejo de normalizarTel() en lib/tel.ts: si cambias uno, cambia el otro.
-- Devuelve null si aquello no es un teléfono: los walk-ins con "—" NO deben
-- convertirse en un cliente fantasma con cientos de visitas.
create or replace function normalizar_tel(p_tel text) returns text
language sql immutable strict as $$
  select case
    -- ya venía con prefijo internacional explícito
    when trim(p_tel) like '+%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) between 9 and 15
      then '+' || regexp_replace(p_tel, '\D', '', 'g')
    -- 0034XXXXXXXXX escrito a la antigua
    when regexp_replace(p_tel, '\D', '', 'g') like '0034%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) = 13
      then '+' || substr(regexp_replace(p_tel, '\D', '', 'g'), 3)
    -- 34XXXXXXXXX sin el signo
    when regexp_replace(p_tel, '\D', '', 'g') like '34%'
         and length(regexp_replace(p_tel, '\D', '', 'g')) = 11
      then '+' || regexp_replace(p_tel, '\D', '', 'g')
    -- nacional español de 9 dígitos
    when length(regexp_replace(p_tel, '\D', '', 'g')) = 9
      then '+34' || regexp_replace(p_tel, '\D', '', 'g')
    else null
  end
$$;

-- ── La tabla ───────────────────────────────────────────────────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  phone text not null,                        -- E.164, ya normalizado
  name text not null,
  email text,
  -- Se rellena cuando el cliente entra con magic link y su email coincide.
  auth_user_id uuid references auth.users(id) on delete set null,
  -- Consentimiento de marketing (art. 21 LSSI-CE): expreso, con prueba de
  -- cuándo y desde dónde. Iniciar sesión NO es consentir publicidad.
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  marketing_opt_in_source text,
  -- Baja de la newsletter a un clic y sin login (/baja/[token]).
  baja_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (salon_id, phone),
  unique (salon_id, auth_user_id)
);
create index customers_salon on customers (salon_id);
create index customers_auth on customers (auth_user_id) where auth_user_id is not null;

alter table customers enable row level security;

-- Sin política para anon: cero filas. Todo acceso público pasa por acciones
-- de servidor con service role validando un token — nunca por RLS abierta.
-- (La lección de public_read_salons no se repite aquí.)
create policy owner_all_customers on customers for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create policy customer_read_self on customers for select
  using (auth_user_id = auth.uid());

-- ── Enlace desde bookings + URL permanente de la cita ──────────────────
alter table bookings add column customer_id uuid references customers(id) on delete set null;
create index bookings_customer on bookings (customer_id);

-- El token es la identidad SIN cuenta: ver, cancelar y la tarjeta de sellos
-- funcionan desde el enlace del email. Crítico porque el canal principal es
-- el navegador interno de Instagram, donde los logins se rompen.
alter table bookings add column public_token uuid not null default gen_random_uuid();
create unique index bookings_public_token on bookings (public_token);

-- ── Vincular cada reserva a su cliente, automáticamente ────────────────
-- Trigger y no código de app: cubre la RPC pública, el alta manual del
-- dueño (INSERT directo) y cualquier vía futura, sin que nadie se acuerde.
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
        -- el email solo se pisa si llega uno nuevo; nunca se borra
        email = coalesce(excluded.email, customers.email)
  returning id into new.customer_id;

  return new;
end $$;

create trigger trg_bookings_vincular_cliente
  before insert on bookings
  for each row execute function bookings_vincular_cliente();

-- ── Backfill de las reservas históricas ────────────────────────────────
-- El nombre/email de cada cliente sale de su reserva más reciente. Los
-- teléfonos que no normalizan ("—" de mostrador) se quedan fuera a propósito.
insert into customers (salon_id, phone, name, email, created_at)
select distinct on (b.salon_id, normalizar_tel(b.customer_phone))
  b.salon_id,
  normalizar_tel(b.customer_phone),
  trim(b.customer_name),
  nullif(trim(coalesce(b.customer_email, '')), ''),
  min(b.created_at) over (partition by b.salon_id, normalizar_tel(b.customer_phone))
from bookings b
where normalizar_tel(b.customer_phone) is not null
order by b.salon_id, normalizar_tel(b.customer_phone), b.created_at desc
on conflict (salon_id, phone) do nothing;

update bookings b
set customer_id = c.id
from customers c
where b.customer_id is null
  and c.salon_id = b.salon_id
  and normalizar_tel(b.customer_phone) = c.phone;

-- ── Detección de features desde la app ─────────────────────────────────
-- La app pregunta qué existe en vez de suponerlo: así el mismo código
-- funciona antes y después de aplicar cada migración, sin ventana de rotura
-- entre deploy y db push. to_regclass es dinámico: una sola definición
-- sirve para todas las migraciones que vengan.
create or replace function features_disponibles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clientes',     to_regclass('public.customers') is not null,
    'fidelizacion', to_regclass('public.loyalty_programs') is not null,
    'productos',    to_regclass('public.products') is not null,
    'newsletter',   to_regclass('public.newsletter_campaigns') is not null,
    'resenas',      to_regclass('public.review_requests') is not null
  )
$$;
grant execute on function features_disponibles() to anon, authenticated;

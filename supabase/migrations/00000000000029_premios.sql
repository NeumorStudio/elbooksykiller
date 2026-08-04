-- Varios premios por salón, no uno solo.
--
-- La tarjeta era un número y un texto: «6 visitas → Corte gratis». Con eso
-- no se puede tener a la vez el corte gratis a las 9 visitas y una gomina a
-- las 5, que es justo lo que pide el primer salón real. Y tampoco puede el
-- dueño añadir o quitar promociones sin llamarnos.
--
-- El modelo es un catálogo, no una escalera. Cada premio cuesta sus sellos y
-- el cliente elige: con 5 se lleva la gomina, con 9 el corte. Quien ya gastó
-- 9 en el corte vuelve a acumular desde cero y a las 5 siguientes tiene la
-- gomina — o sea, el «segundo nivel» que pedían sale solo del contador, sin
-- guardar en qué escalón va cada cliente ni encadenar nada.
--
-- `loyalty_programs` se queda como el interruptor general de la tarjeta
-- (active) y como el premio por defecto de quien no toque nada.

create table if not exists loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  -- Lo que cuesta en sellos. Un sello = un servicio completado.
  stamps int not null check (stamps between 1 and 100),
  -- Si el premio es un artículo del catálogo, se enlaza para poder enseñar
  -- su foto. `set null` y no `cascade`: borrar el bote de cera de la tienda
  -- no debe hacer desaparecer el premio de las tarjetas a medio llenar.
  product_id uuid references products(id) on delete set null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists premios_por_salon on loyalty_rewards (salon_id, active);

alter table loyalty_rewards enable row level security;

-- El dueño manda sobre los suyos.
drop policy if exists owner_all_rewards on loyalty_rewards;
create policy owner_all_rewards on loyalty_rewards for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- Y cualquiera puede leer los activos: el cliente ve en su cita qué puede
-- llevarse. Son el nombre y un número, nada sensible.
drop policy if exists public_read_rewards on loyalty_rewards;
create policy public_read_rewards on loyalty_rewards for select
  using (active);

grant select on loyalty_rewards to anon, authenticated;
grant insert, update, delete on loyalty_rewards to authenticated;

-- ── El premio que ya existía pasa a ser la primera fila ────────────────
-- Sin esto, al desplegar el catálogo los salones con tarjeta se quedarían
-- sin premios de golpe. Solo se copia si no hay ninguno todavía.
insert into loyalty_rewards (salon_id, name, stamps, sort_order)
select lp.salon_id, lp.reward, lp.required_visits, 0
from loyalty_programs lp
where not exists (
  select 1 from loyalty_rewards r where r.salon_id = lp.salon_id
);

-- ── Canje de un premio concreto ───────────────────────────────────────
--
-- La función vieja (canjear_premio) canjeaba «el premio» del salón, que era
-- único. Esta recibe cuál, comprueba que sea de ese salón y consume tantos
-- sellos como cueste, los más antiguos primero. Se deja la vieja intacta
-- para no romper el código desplegado mientras se despliega este.
create or replace function canjear_premio_v2(p_customer uuid, p_reward uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid; v_stamps int; v_nombre text; v_disponibles int; v_redemption uuid;
begin
  -- Solo el dueño del salón de ese cliente puede canjear.
  select c.salon_id into v_salon
  from customers c join salons s on s.id = c.salon_id
  where c.id = p_customer and s.owner_id = auth.uid();
  if v_salon is null then raise exception 'not_authorized'; end if;

  -- La tarjeta tiene que estar encendida: apagarla debe frenar los canjes,
  -- no solo dejar de dar sellos.
  if not exists (select 1 from loyalty_programs lp where lp.salon_id = v_salon and lp.active) then
    raise exception 'program_inactive';
  end if;

  -- Y el premio, ser de este salón y estar activo. Sin esta comprobación se
  -- podría canjear el premio barato de otro salón contra los sellos propios.
  select r.name, r.stamps into v_nombre, v_stamps
  from loyalty_rewards r
  where r.id = p_reward and r.salon_id = v_salon and r.active;
  if v_stamps is null then raise exception 'reward_not_found'; end if;

  select count(*) into v_disponibles
  from loyalty_stamps where customer_id = p_customer and redemption_id is null;
  if v_disponibles < v_stamps then raise exception 'not_enough_stamps'; end if;

  -- `reward_text` guarda el nombre del momento: si mañana el premio cambia
  -- de nombre o se borra, el historial sigue diciendo qué se llevó.
  insert into loyalty_redemptions (customer_id, salon_id, redeemed_by, visits_consumed, reward_text)
  values (p_customer, v_salon, auth.uid(), v_stamps, v_nombre)
  returning id into v_redemption;

  update loyalty_stamps set redemption_id = v_redemption
  where id in (
    select id from loyalty_stamps
    where customer_id = p_customer and redemption_id is null
    order by earned_at asc
    limit v_stamps
  );

  return jsonb_build_object('redemption_id', v_redemption, 'reward', v_nombre);
end $$;

grant execute on function canjear_premio_v2(uuid, uuid) to authenticated;

create or replace function features_disponibles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clientes',       to_regclass('public.customers') is not null,
    'fidelizacion',   to_regclass('public.loyalty_programs') is not null,
    'productos',      to_regclass('public.products') is not null,
    'newsletter',     to_regclass('public.newsletter_campaigns') is not null,
    'resenas',        to_regclass('public.review_requests') is not null,
    'penalizaciones', to_regclass('public.penalty_programs') is not null,
    'push',           to_regclass('public.push_subscriptions') is not null,
    'recordatorios',  to_regclass('public.reminders') is not null,
    'premios',        to_regclass('public.loyalty_rewards') is not null,
    'cancelaciones',  exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'bookings'
                          and column_name = 'cancelled_at'
                      )
  )
$$;

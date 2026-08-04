-- Los premios son hitos por seguir viniendo, no monedas que se gastan.
--
-- La 0029 los montó como un catálogo con precio: cada premio costaba N
-- sellos y al canjearlo se consumían. Eso no es lo que pide el salón, y de
-- hecho es peor para él: quien se llevaba el bote a las 5 visitas volvía a
-- cero y no llegaba nunca al corte gratis, así que el premio pequeño se
-- comía al grande.
--
-- Lo que quiere es una escalera sobre las visitas acumuladas:
--
--     visita 9  →  el décimo corte, gratis
--     visita 15 →  gel
--
-- Es decir, el contador NO se reinicia: cuenta visitas de toda la vida del
-- cliente, y cada premio se entrega una sola vez al llegar a su escalón. El
-- gel es «para el que sigue viniendo después del corte gratis», no una
-- alternativa barata para el que acaba de empezar.
--
-- Por eso `loyalty_rewards.stamps` pasa a leerse como **la visita en la que
-- toca**, no como su precio. La columna se queda con el mismo nombre para no
-- romper lo desplegado; lo que cambia es quién la interpreta y cómo.

-- Qué premio se entregó en cada canje: es lo que impide repetir un escalón.
alter table loyalty_redemptions
  add column if not exists reward_id uuid references loyalty_rewards(id) on delete set null;

create index if not exists canjes_por_premio on loyalty_redemptions (customer_id, reward_id);

/**
 * Entrega un premio de la escalera.
 *
 * Diferencias con la v2, que era de catálogo:
 *   · mira las visitas TOTALES del cliente, canjeadas o no;
 *   · no consume sellos — el contador nunca baja;
 *   · y no deja entregar dos veces el mismo escalón.
 */
create or replace function entregar_premio(p_customer uuid, p_reward uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid; v_visita int; v_nombre text; v_total int; v_redemption uuid;
begin
  -- Solo el dueño del salón de ese cliente.
  select c.salon_id into v_salon
  from customers c join salons s on s.id = c.salon_id
  where c.id = p_customer and s.owner_id = auth.uid();
  if v_salon is null then raise exception 'not_authorized'; end if;

  if not exists (select 1 from loyalty_programs lp where lp.salon_id = v_salon and lp.active) then
    raise exception 'program_inactive';
  end if;

  select r.name, r.stamps into v_nombre, v_visita
  from loyalty_rewards r
  where r.id = p_reward and r.salon_id = v_salon and r.active;
  if v_visita is null then raise exception 'reward_not_found'; end if;

  -- Visitas de toda la vida: aquí NO se filtra por redemption_id, que es
  -- justo lo que hacía que el contador volviera a cero.
  select count(*) into v_total from loyalty_stamps where customer_id = p_customer;
  if v_total < v_visita then raise exception 'not_enough_stamps'; end if;

  if exists (
    select 1 from loyalty_redemptions
    where customer_id = p_customer and reward_id = p_reward
  ) then
    raise exception 'already_redeemed';
  end if;

  -- `visits_consumed` guarda el escalón, no un gasto: sirve para el
  -- historial («se llevó el corte en la visita 9»).
  insert into loyalty_redemptions (customer_id, salon_id, redeemed_by, visits_consumed, reward_text, reward_id)
  values (p_customer, v_salon, auth.uid(), v_visita, v_nombre, p_reward)
  returning id into v_redemption;

  return jsonb_build_object('redemption_id', v_redemption, 'reward', v_nombre);
end $$;

grant execute on function entregar_premio(uuid, uuid) to authenticated;

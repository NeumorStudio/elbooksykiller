-- Comprueba la migración 0034 (permisos de trabajador) contra la base de DEV.
--
-- Igual que comprobar-0033: pegar entero en el editor SQL del proyecto de
-- dev y ejecutar. TERMINA SIEMPRE EN ERROR a propósito —el mensaje es el
-- resultado— y al fallar Postgres deshace todo lo que creó.

do $$
declare
  v_salon uuid; v_owner uuid; v_srv uuid; v_dur int;
  v_emp uuid; v_emp2 uuid;
  v_user uuid := gen_random_uuid();
  v_mia uuid; v_suya uuid; v_pagada uuid; v_empezada uuid; v_nueva uuid;
  v_t0 timestamptz := date_trunc('hour', now()) + interval '3 days 10 hours';
  v_n int; v_ok boolean; v_ts timestamptz; v_txt text; v_tel text; v_tok uuid;
  bien int := 0; total int := 0; informe text := '';

  -- Cambia de identidad: como trabajador, o de vuelta a postgres.
  -- (No hay subprocedimientos en un DO: se repite el par de líneas.)
begin
  if exists (select 1 from salons where slug = 'paye-villalobos') then
    raise exception 'ABORTADO: esta base tiene el piloto real. Esto es producción.';
  end if;
  select id, owner_id into v_salon, v_owner from salons where slug = 'salon-de-pruebas';
  if v_salon is null then raise exception 'No encuentro el salón salon-de-pruebas.'; end if;
  select id, duration_min into v_srv, v_dur from services where salon_id = v_salon and active limit 1;
  if v_srv is null then raise exception 'El salón de pruebas no tiene servicios.'; end if;

  -- ── Datos de prueba ──────────────────────────────────────────────────
  insert into employees (salon_id, name) values (v_salon, 'Prueba 0034') returning id into v_emp;
  insert into employees (salon_id, name) values (v_salon, 'Prueba 0034 compañero') returning id into v_emp2;
  insert into auth.users (id, email, aud, role, instance_id)
    values (v_user, 'prueba-0034@example.invalid', 'authenticated', 'authenticated',
            '00000000-0000-0000-0000-000000000000');
  insert into employee_access (employee_id, user_id, email)
    values (v_emp, v_user, 'prueba-0034@example.invalid');

  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp, v_srv, 'Cliente mía', '611000001', v_t0, v_t0 + make_interval(mins => v_dur))
    returning id into v_mia;
  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp2, v_srv, 'Cliente del compañero', '611000002', v_t0, v_t0 + make_interval(mins => v_dur))
    returning id into v_suya;
  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at, payment_status)
    values (v_salon, v_emp2, v_srv, 'Cliente que pagó', '611000003',
            v_t0 + interval '2 hours', v_t0 + interval '2 hours' + make_interval(mins => v_dur), 'paid')
    returning id into v_pagada;
  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp, v_srv, 'Cliente empezada', '611000004',
            now() - interval '10 minutes', now() - interval '10 minutes' + make_interval(mins => v_dur))
    returning id into v_empezada;

  -- ════ 1. SIN PERMISOS ════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from mi_puesto() where not ver_agenda_equipo and not apuntar_citas;
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · mi_puesto no trae los permisos apagados'; end if;

  total := total + 1;
  select count(*) into v_n from agenda_equipo(now() - interval '1 day', now() + interval '30 days');
  if v_n = 2 then bien := bien + 1; else informe := informe || format(' · sin permisos ve %s citas (esperaba sus 2)', v_n); end if;

  total := total + 1;
  select public_token into v_tok from agenda_equipo(now() - interval '1 day', now() + interval '30 days') where id = v_mia;
  if v_tok is null then bien := bien + 1; else informe := informe || ' · sin apuntar ve el enlace público'; end if;

  total := total + 1;
  begin
    perform * from apuntar_cita(v_emp, v_srv, v_t0 + interval '5 hours', 'Nadie', '');
    informe := informe || ' · apunta sin permiso';
  exception when others then if sqlerrm = 'sin_permiso' then bien := bien + 1; else informe := informe || ' · apuntar: ' || sqlerrm; end if;
  end;

  total := total + 1;
  begin
    perform mover_cita_equipo(v_mia, v_t0 + interval '1 hour');
    informe := informe || ' · mueve sin permiso';
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  begin
    perform cancelar_cita_equipo(v_mia);
    informe := informe || ' · cancela sin permiso';
  exception when others then bien := bien + 1;
  end;

  -- ════ 2. SOLO VER LA AGENDA ══════════════════════════════════════════
  execute 'reset role';
  update employee_access set ver_agenda_equipo = true, apuntar_citas = false where employee_id = v_emp;
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from agenda_equipo(now() - interval '1 day', now() + interval '30 days')
   where id in (v_mia, v_suya, v_pagada, v_empezada);
  if v_n = 4 then bien := bien + 1; else informe := informe || format(' · viendo el equipo ve %s (esperaba 4)', v_n); end if;

  total := total + 1;
  select customer_phone, public_token into v_tel, v_tok
    from agenda_equipo(now() - interval '1 day', now() + interval '30 days') where id = v_suya;
  if v_tel is null and v_tok is null then bien := bien + 1; else informe := informe || ' · ve teléfono o enlace del compañero sin poder apuntar'; end if;

  total := total + 1;
  select customer_phone into v_tel from agenda_equipo(now() - interval '1 day', now() + interval '30 days') where id = v_mia;
  if v_tel is not null then bien := bien + 1; else informe := informe || ' · no ve el teléfono de su propia cita'; end if;

  total := total + 1;
  begin
    perform * from apuntar_cita(v_emp, v_srv, v_t0 + interval '5 hours', 'Nadie', '');
    informe := informe || ' · ver la agenda deja apuntar';
  exception when others then bien := bien + 1;
  end;

  -- ════ 3. SOLO APUNTAR (sus citas) ════════════════════════════════════
  execute 'reset role';
  update employee_access set ver_agenda_equipo = false, apuntar_citas = true where employee_id = v_emp;
  execute 'set local role authenticated';

  total := total + 1;
  select cita_id into v_nueva from apuntar_cita(v_emp, v_srv, v_t0 + interval '5 hours', 'Cliente nuevo', '612 345 678');
  if v_nueva is not null then bien := bien + 1; else informe := informe || ' · no apunta en su agenda'; end if;

  total := total + 1;
  begin
    perform * from apuntar_cita(v_emp2, v_srv, v_t0 + interval '6 hours', 'Nadie', '');
    informe := informe || ' · apunta al compañero sin ver su agenda';
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  begin
    perform * from apuntar_cita(v_emp, v_srv, v_t0 + interval '7 hours', 'Nadie', '12');
    informe := informe || ' · acepta un teléfono roto';
  exception when others then if sqlerrm = 'telefono_invalido' then bien := bien + 1; else informe := informe || ' · teléfono: ' || sqlerrm; end if;
  end;

  total := total + 1;
  select mover_cita_equipo(v_mia, v_t0 + interval '1 hour') into v_ts;
  if v_ts = v_t0 then bien := bien + 1; else informe := informe || ' · mover no devuelve la hora vieja'; end if;

  total := total + 1;
  begin
    perform mover_cita_equipo(v_suya, v_t0 + interval '8 hours');
    informe := informe || ' · mueve la cita del compañero sin verla';
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  begin
    perform mover_cita_equipo(v_empezada, v_t0 + interval '9 hours');
    informe := informe || ' · mueve una cita ya empezada';
  exception when others then if sqlerrm = 'ya_empezada' then bien := bien + 1; else informe := informe || ' · empezada: ' || sqlerrm; end if;
  end;

  total := total + 1;
  select public_token into v_tok from agenda_equipo(now() - interval '1 day', now() + interval '30 days') where id = v_mia;
  if v_tok is not null then bien := bien + 1; else informe := informe || ' · pudiendo apuntar no ve el enlace para el WhatsApp'; end if;

  total := total + 1;
  select cancelar_cita_equipo(v_nueva) into v_ok;
  if v_ok then bien := bien + 1; else informe := informe || ' · no cancela su cita'; end if;

  -- ════ 4. LAS DOS COSAS ═══════════════════════════════════════════════
  execute 'reset role';
  update employee_access set ver_agenda_equipo = true, apuntar_citas = true where employee_id = v_emp;
  execute 'set local role authenticated';

  total := total + 1;
  select cita_id into v_nueva from apuntar_cita(v_emp2, v_srv, v_t0 + interval '6 hours', 'Para el compañero', '');
  if v_nueva is not null then bien := bien + 1; else informe := informe || ' · no apunta al compañero viendo el equipo'; end if;

  total := total + 1;
  begin
    perform * from apuntar_cita(v_emp2, v_srv, v_t0, 'Encima de otra', '');
    informe := informe || ' · deja pisar una cita';
  exception when others then if sqlerrm like '%no_overlap%' then bien := bien + 1; else informe := informe || ' · solape: ' || sqlerrm; end if;
  end;

  total := total + 1;
  begin
    perform cancelar_cita_equipo(v_pagada);
    informe := informe || ' · cancela una cita pagada';
  exception when others then if sqlerrm = 'pagada' then bien := bien + 1; else informe := informe || ' · pagada: ' || sqlerrm; end if;
  end;

  -- ── Lo que quedó escrito, visto como postgres ────────────────────────
  execute 'reset role';

  total := total + 1;
  select count(*) into v_n from bookings where id = v_nueva and source = 'panel';
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · la cita apuntada no sale como «panel»'; end if;

  total := total + 1;
  select count(*) into v_n from bookings
   where salon_id = v_salon and customer_name = 'Cliente nuevo' and status = 'cancelled' and cancelled_by = 'salon';
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · la cancelada no cuenta como del salón'; end if;

  total := total + 1;
  select count(*) into v_n from bookings
   where id = v_mia and ends_at = v_t0 + interval '1 hour' + make_interval(mins => v_dur);
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · al mover no se recalcula el final'; end if;

  -- ════ 5. ANÓNIMO Y DUEÑO ═════════════════════════════════════════════
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  total := total + 1;
  begin
    perform * from agenda_equipo(now(), now() + interval '1 day');
    informe := informe || ' · anon llama a agenda_equipo';
  exception when others then bien := bien + 1;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  select count(*) into v_n from agenda_equipo(now() - interval '1 day', now() + interval '30 days');
  if v_n = 0 then bien := bien + 1; else informe := informe || ' · el dueño sale como trabajador en agenda_equipo'; end if;

  -- ════ 6. DE BAJA, TODO APAGADO ═══════════════════════════════════════
  execute 'reset role';
  update employees set active = false where id = v_emp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from agenda_equipo(now() - interval '1 day', now() + interval '30 days');
  begin
    perform * from apuntar_cita(v_emp2, v_srv, v_t0 + interval '10 hours', 'Nadie', '');
    informe := informe || ' · de baja sigue apuntando';
  exception when others then
    if v_n = 0 then bien := bien + 1; else informe := informe || ' · de baja sigue viendo la agenda'; end if;
  end;

  execute 'reset role';
  total := total + 1;
  if (features_disponibles() ->> 'permisos_equipo')::boolean then bien := bien + 1;
  else informe := informe || ' · features_disponibles no enciende «permisos_equipo»'; end if;

  v_txt := format('RESULTADO: %s de %s bien%s', bien, total,
                  case when informe = '' then '. Todo deshecho.' else ' — FALLOS:' || informe end);
  raise exception '%', v_txt;
end $$;

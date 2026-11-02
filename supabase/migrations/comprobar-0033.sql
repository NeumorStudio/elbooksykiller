-- Comprueba la migración 0033 (acceso de trabajadores) contra la base de DEV.
--
-- Pegar entero en el editor SQL de Supabase del proyecto de dev y ejecutar.
-- Todo va dentro de un único bloque que TERMINA SIEMPRE EN ERROR a propósito:
-- el mensaje del error es el resultado («RESULTADO: n de n bien …») y, al
-- fallar, Postgres deshace todo lo que el bloque creó. No queda nada que
-- borrar: ni la ficha de prueba, ni la cuenta, ni las citas.
--
-- Hace de trabajador, de dueño y de visitante anónimo cambiando de rol y de
-- `request.jwt.claims`, que es exactamente lo que mira `auth.uid()`.

do $$
declare
  v_salon uuid; v_owner uuid; v_srv uuid;
  v_emp uuid; v_emp2 uuid;
  v_user uuid := gen_random_uuid();
  v_mia uuid; v_futura uuid; v_ajena uuid;
  v_n int; v_ok boolean; v_txt text;
  bien int := 0; total int := 0; informe text := '';
begin
  -- ── Cerrojo: solo dev ────────────────────────────────────────────────
  -- En producción existe el piloto `paye-villalobos`; en dev el salón de
  -- pruebas se LLAMA igual pero su slug es `salon-de-pruebas`.
  if exists (select 1 from salons where slug = 'paye-villalobos') then
    raise exception 'ABORTADO: esta base tiene el piloto real. Esto es producción.';
  end if;
  select id, owner_id into v_salon, v_owner from salons where slug = 'salon-de-pruebas';
  if v_salon is null then raise exception 'No encuentro el salón salon-de-pruebas.'; end if;
  select id into v_srv from services where salon_id = v_salon and active limit 1;
  if v_srv is null then raise exception 'El salón de pruebas no tiene servicios.'; end if;

  -- ── Datos de prueba (se deshacen solos al final) ─────────────────────
  insert into employees (salon_id, name) values (v_salon, 'Prueba 0033') returning id into v_emp;
  insert into employees (salon_id, name) values (v_salon, 'Prueba 0033 compañero') returning id into v_emp2;
  insert into auth.users (id, email, aud, role, instance_id)
    values (v_user, 'prueba-0033@example.invalid', 'authenticated', 'authenticated',
            '00000000-0000-0000-0000-000000000000');
  insert into employee_access (employee_id, user_id, email)
    values (v_emp, v_user, 'prueba-0033@example.invalid');

  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp, v_srv, 'Cliente empezada', '600000001',
            now() - interval '10 minutes', now() + interval '20 minutes') returning id into v_mia;
  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp, v_srv, 'Cliente mañana', '600000002',
            now() + interval '1 day', now() + interval '1 day 30 minutes') returning id into v_futura;
  insert into bookings (salon_id, employee_id, service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_salon, v_emp2, v_srv, 'Cliente del compañero', '600000003',
            now() - interval '10 minutes', now() + interval '20 minutes') returning id into v_ajena;

  -- ── Como TRABAJADOR ──────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from mi_puesto() where employee_id = v_emp and active;
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · mi_puesto no devuelve su ficha'; end if;

  total := total + 1;
  select count(*) into v_n from mis_citas(now() - interval '1 day', now() + interval '3 days');
  if v_n = 2 then bien := bien + 1; else informe := informe || format(' · mis_citas devuelve %s (esperaba 2)', v_n); end if;

  total := total + 1;
  select count(*) into v_n from mis_citas(now() - interval '1 day', now() + interval '3 days') where id = v_ajena;
  if v_n = 0 then bien := bien + 1; else informe := informe || ' · ve la cita del compañero'; end if;

  total := total + 1;
  select count(*) into v_n from mis_citas(now() - interval '1 day', now() + interval '90 days');
  if v_n = 0 then bien := bien + 1; else informe := informe || ' · la ventana de 62 días no frena'; end if;

  total := total + 1;
  select count(*) into v_n from bookings;
  if v_n = 0 then bien := bien + 1; else informe := informe || format(' · lee %s filas de bookings directamente', v_n); end if;

  total := total + 1;
  begin
    execute 'select count(*) from customers' into v_n;
    if v_n = 0 then bien := bien + 1; else informe := informe || ' · lee clientes'; end if;
  exception when others then bien := bien + 1; -- sin permiso también vale
  end;

  total := total + 1;
  select count(*) into v_n from employee_access;
  if v_n = 1 then bien := bien + 1; else informe := informe || format(' · ve %s vínculos (esperaba solo el suyo)', v_n); end if;

  total := total + 1;
  begin
    insert into employee_access (employee_id, user_id, email) values (v_emp2, v_user, 'x@example.invalid');
    informe := informe || ' · puede escribir en employee_access';
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  begin
    update employees set name = 'hackeado' where id = v_emp2;
    get diagnostics v_n = row_count;
    if v_n = 0 then bien := bien + 1; else informe := informe || ' · puede renombrar fichas'; end if;
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  select marcar_mi_cita(v_futura, 'no_show') into v_ok;
  if not v_ok then bien := bien + 1; else informe := informe || ' · marca «no vino» en una cita futura'; end if;

  total := total + 1;
  select marcar_mi_cita(v_ajena, 'completed') into v_ok;
  if not v_ok then bien := bien + 1; else informe := informe || ' · marca la cita del compañero'; end if;

  total := total + 1;
  select marcar_mi_cita(v_mia, 'completed') into v_ok;
  if v_ok then bien := bien + 1; else informe := informe || ' · no puede marcar su cita empezada'; end if;

  total := total + 1;
  begin
    perform marcar_mi_cita(v_mia, 'cancelled');
    informe := informe || ' · deja poner un estado que no toca';
  exception when others then bien := bien + 1;
  end;

  -- ── Como ANÓNIMO ─────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';

  total := total + 1;
  begin
    perform * from mi_puesto();
    informe := informe || ' · anon puede llamar a mi_puesto';
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  begin
    execute 'select count(*) from employee_access' into v_n;
    informe := informe || ' · anon lee employee_access';
  exception when others then bien := bien + 1;
  end;

  -- ── Como DUEÑO ───────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from employee_access where employee_id = v_emp;
  if v_n = 1 then bien := bien + 1; else informe := informe || ' · el dueño no ve el acceso de su equipo'; end if;

  total := total + 1;
  begin
    delete from employee_access where employee_id = v_emp;
    get diagnostics v_n = row_count;
    if v_n = 0 then bien := bien + 1; else informe := informe || ' · el dueño borra vínculos por REST'; end if;
  exception when others then bien := bien + 1;
  end;

  total := total + 1;
  select count(*) into v_n from mi_puesto();
  if v_n = 0 then bien := bien + 1; else informe := informe || ' · el dueño sale como trabajador'; end if;

  -- ── Dar de baja apaga el acceso solo ─────────────────────────────────
  execute 'reset role';
  update employees set active = false where id = v_emp;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into v_n from mis_citas(now() - interval '1 day', now() + interval '3 days');
  select marcar_mi_cita(v_mia, 'no_show') into v_ok;
  if v_n = 0 and not v_ok then bien := bien + 1; else informe := informe || ' · de baja sigue viendo o marcando'; end if;

  -- ── El interruptor ───────────────────────────────────────────────────
  execute 'reset role';
  total := total + 1;
  if (features_disponibles() ->> 'trabajadores')::boolean then bien := bien + 1;
  else informe := informe || ' · features_disponibles no enciende «trabajadores»'; end if;

  v_txt := format('RESULTADO: %s de %s bien%s', bien, total,
                  case when informe = '' then '. Todo deshecho.' else ' — FALLOS:' || informe end);
  raise exception '%', v_txt;
end $$;

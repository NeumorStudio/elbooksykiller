-- Las altas de salón las damos nosotros, no el que se registra.
--
-- `owner_all_salons` era `for all`, así que incluía INSERT con
-- `with check (owner_id = auth.uid())`: cualquier cuenta podía crear su salón.
-- Quitar el formulario del panel no cerraba nada — la clave pública va en el
-- bundle, y un POST a PostgREST se salta la interfaz entera.
--
-- Se sustituye por las tres operaciones que el dueño sí necesita sobre su
-- fila. Sin política de INSERT, la tabla solo acepta filas nuevas por service
-- role: el editor SQL, o nosotros.
--
-- DELETE se queda: es su salón y sus datos, y el borrado en cascada es lo que
-- hace falta el día que alguien ejerza el derecho de supresión.

drop policy owner_all_salons on salons;

create policy owner_select_salons on salons for select
  using (owner_id = auth.uid());

create policy owner_update_salons on salons for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_delete_salons on salons for delete
  using (owner_id = auth.uid());

-- Cinturón además del tirante: sin el grant, un INSERT ni siquiera llega a
-- evaluar políticas. Si algún día vuelve el alta desde la app, hay que
-- deshacer las dos cosas, y eso obliga a pensarlo.
revoke insert on salons from authenticated, anon;

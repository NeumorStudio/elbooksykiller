-- La tabla de respaldo estaba abierta al público.
--
-- `_backup_salones_borrados` la crea a mano el proceso de borrado de salones,
-- no una migración, así que nació sin RLS y con los grants por defecto que
-- Supabase da a `anon`. Resultado: cualquiera con la clave del bundle podía
-- leer —y escribir, y borrar— los volcados completos de los salones
-- eliminados: sus clientes, sus citas y sus teléfonos. Verificado en vivo el
-- 2026-07-30 con la clave publicable: HTTP 200 y las dos filas.
--
-- El volcado lo escribe y lo lee `service_role`, que salta RLS, así que
-- revocar `anon`/`authenticated` no rompe ni las copias ni el borrado.
--
-- Va condicionada porque la tabla no la crea ninguna migración: en una base
-- donde no exista (dev, hoy) esto es un no-op en vez de un error. Si algún
-- día se crea allí, hay que volver a pasar esto — o mejor, crearla ya con
-- RLS puesta.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = '_backup_salones_borrados'
  ) then
    execute 'alter table public._backup_salones_borrados enable row level security';
    execute 'revoke all on public._backup_salones_borrados from anon, authenticated';
  end if;
end $$;

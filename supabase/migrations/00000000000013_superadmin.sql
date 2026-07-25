-- Superadmin: bloqueo de salones y módulos por plan.
--
-- `blocked` apaga el salón entero: su web pública devuelve 404 y su panel
-- muestra un aviso. `modules` apaga secciones sueltas del panel, pensadas
-- como los módulos de un plan de pago: {"productos": false}. NULL significa
-- todos los módulos activos (el comportamiento de hoy).

alter table salons add column blocked boolean not null default false;
alter table salons add column modules jsonb;

-- El dueño edita su salón vía RLS, pero estas dos columnas son solo del
-- superadmin (service role): sin esto, un dueño podría desbloquearse o
-- encenderse módulos con su propio JWT contra la API REST.
create or replace function protege_columnas_superadmin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    new.blocked := old.blocked;
    new.modules := old.modules;
  end if;
  return new;
end $$;

-- Solo la dispara el trigger; que no sea llamable como RPC.
revoke execute on function protege_columnas_superadmin() from public, anon, authenticated;

create trigger salons_protege_superadmin
  before update on salons
  for each row execute function protege_columnas_superadmin();

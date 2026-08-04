-- El dueño también puede recibir avisos en el móvil.
--
-- Hasta ahora una suscripción colgaba siempre de `customers`, así que el
-- push era solo para clientes finales. Al dueño —la persona a la que más le
-- cambia el día una reserva nueva o una cancelación— se le avisaba
-- únicamente por correo: uno por reserva, uno por cancelación y uno por
-- valoración baja. Con la agenda llena eso es cerca de una quinta parte de
-- los 100 correos diarios del plan, todos para el mismo señor, que además
-- tiene el panel instalado como app en el móvil.
--
-- La suscripción pasa a ser de un cliente **o** de una cuenta, nunca de las
-- dos ni de ninguna. Eso lo garantiza el CHECK, no la buena intención de
-- quien escriba el próximo insert.

alter table push_subscriptions
  alter column customer_id drop not null;

alter table push_subscriptions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_destinatario_check'
  ) then
    alter table push_subscriptions add constraint push_subscriptions_destinatario_check
      check ((customer_id is not null) <> (user_id is not null));
  end if;
end $$;

create index if not exists push_por_usuario on push_subscriptions (user_id);

-- La RLS sigue sin políticas, y por el mismo motivo de siempre: `endpoint` es
-- una URL capaz de escribirle notificaciones a ese móvil y `auth` la clave
-- para cifrarlas. Todo pasa por server actions con service role.

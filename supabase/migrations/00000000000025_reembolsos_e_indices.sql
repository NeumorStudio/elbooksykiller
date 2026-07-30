-- Dos cosas que el linter y la realidad venían pidiendo.
--
-- 1) Reembolsos que se puedan registrar.
--
-- `bookings_payment_status_check` solo admitía 'none', 'pending' y 'paid', así
-- que un reembolso no tenía dónde anotarse: había que dejar la cita como
-- 'paid' y apuntarlo fuera de la base, o mentir poniéndola en 'none'. Hoy no
-- aprieta porque los cobros están apagados (`charges_enabled = false` y
-- `modules->>'cobros' = 'false'` en los dos salones), y justamente por eso es
-- el momento de arreglarlo: cambiar el check con pagos vivos da más miedo.
--
-- 2) Las nueve claves foráneas sin índice.
--
-- Postgres NO crea índice al declarar una foreign key, solo al declarar la
-- clave primaria o un unique. Sin él, cada borrado del lado padre hace un
-- recorrido completo de la tabla hija para comprobar que no queda nadie
-- colgando — y los JOIN por esas columnas, que la app hace en casi todas las
-- pantallas, tampoco los aprovechan.
--
-- Con 2 salones no se nota nada. Con 50 y un año de citas encima, sí. Se hacen
-- ahora porque son gratis: las tablas están casi vacías, así que cada índice
-- se construye al instante y no hace falta CONCURRENTLY.
--
-- `salons.owner_id` se queda con índice NORMAL, no único, a propósito. La app
-- asume un salón por dueño (`.limit(1)` sin `order by`), y hacerlo único sería
-- la forma de garantizarlo de verdad — pero eso prohibiría que un dueño tenga
-- dos salones, y esa es una decisión de producto, no de rendimiento. Aquí solo
-- se arregla el índice que falta.

alter table bookings drop constraint if exists bookings_payment_status_check;
alter table bookings add constraint bookings_payment_status_check
  check (payment_status = any (array['none', 'pending', 'paid', 'refunded']));

create index if not exists idx_bookings_service_id            on bookings (service_id);
create index if not exists idx_employees_salon_id             on employees (salon_id);
create index if not exists idx_loyalty_redemptions_redeemed_by on loyalty_redemptions (redeemed_by);
create index if not exists idx_loyalty_stamps_redemption_id   on loyalty_stamps (redemption_id);
create index if not exists idx_newsletter_campaigns_created_by on newsletter_campaigns (created_by);
create index if not exists idx_salons_owner_id                on salons (owner_id);
create index if not exists idx_services_salon_id              on services (salon_id);
create index if not exists idx_time_off_employee_id           on time_off (employee_id);
create index if not exists idx_working_hours_employee_id      on working_hours (employee_id);

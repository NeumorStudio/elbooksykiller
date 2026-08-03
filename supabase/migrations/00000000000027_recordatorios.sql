-- Qué recordatorio se le ha mandado ya a cada cita.
--
-- Hasta ahora la idempotencia la ponía Resend con su `idempotencyKey`, y el
-- propio código dejaba escrito que eso era un parche: «un unique (booking_id,
-- kind) es una garantía de base de datos y esto solo es una garantía de
-- proveedor». Con un solo aviso se aguantaba. Con dos —la víspera y la hora
-- antes— ya no, y sobre todo porque **el push nunca estuvo cubierto**: la
-- ventana de envío es más ancha que el intervalo del cron a propósito (para
-- que un tick perdido no deje a nadie sin aviso), así que cada cita cae en
-- dos o tres ejecuciones y el móvil vibraba una vez por cada una. El correo
-- se salvaba por Resend; la notificación, no.
--
-- La clave primaria compuesta es la garantía: insertar es pedir el turno, y
-- solo quien lo consigue envía. Dos ejecuciones simultáneas no pueden
-- ganarla las dos.
create table if not exists reminders (
  booking_id uuid not null references bookings(id) on delete cascade,
  kind text not null check (kind in ('vispera', 'hora')),
  sent_at timestamptz not null default now(),
  primary key (booking_id, kind)
);

-- Sin políticas y a propósito, como `push_subscriptions`: esto no lo toca
-- nadie desde el navegador. El cron entra con service_role, que se salta la
-- RLS; cualquier otro se queda fuera por defecto. El linter lo marcará como
-- aviso, y es correcto que lo haga.
alter table reminders enable row level security;

-- Purga: un recordatorio de hace meses no dice nada que no diga la propia
-- cita, y esta tabla crece una fila por aviso enviado.
create index if not exists reminders_sent_at_idx on reminders (sent_at);

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
    'cancelaciones',  exists (
                        select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = 'bookings'
                          and column_name = 'cancelled_at'
                      )
  )
$$;

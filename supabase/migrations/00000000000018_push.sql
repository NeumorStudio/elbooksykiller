-- Suscripciones de notificaciones push, para el recordatorio de 1 hora.
--
-- El correo llega, pero a una hora de la cita nadie abre el correo. Una
-- notificación en el móvil sí se ve, y ese aviso es justo el que evita la
-- falta — que es el problema que las penalizaciones castigan pero no
-- previenen.
--
-- De paso descarga a Resend: el plan gratuito son 100 emails al DÍA, y los
-- recordatorios son el envío más repetitivo de todos.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  -- El navegador devuelve estas tres cosas y no se pueden inventar.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  -- Un endpoint muerto (app desinstalada, permiso retirado) responde 404 o
  -- 410. Se guarda para poder limpiarlos sin volver a intentarlo cada hora.
  fallos int not null default 0
);

create index push_por_cliente on push_subscriptions (customer_id);

alter table push_subscriptions enable row level security;

-- Sin políticas: nadie llega por la API pública. Se escribe desde una
-- server action que exige el token de la cita —es la prueba de que quien
-- suscribe es el dueño de esa reserva— y se lee desde el cron. Los dos van
-- con service role, que se salta RLS.
--
-- Que no haya política es la decisión, no un olvido: `endpoint` es una URL
-- capaz de enviar notificaciones a ese móvil, y `auth` la clave para
-- cifrarlas. Quien las lea puede escribirle al cliente en nombre del salón.

create or replace function features_disponibles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clientes',       to_regclass('public.customers') is not null,
    'fidelizacion',   to_regclass('public.loyalty_programs') is not null,
    'productos',      to_regclass('public.products') is not null,
    'newsletter',     to_regclass('public.newsletter_campaigns') is not null,
    'resenas',        to_regclass('public.review_requests') is not null,
    'penalizaciones', to_regclass('public.penalty_programs') is not null,
    'push',           to_regclass('public.push_subscriptions') is not null
  )
$$;

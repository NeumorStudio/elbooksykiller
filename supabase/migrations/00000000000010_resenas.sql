-- Petición de reseña tras el servicio.
--
-- Sin incentivo condicionado y sin review gating: incentivar reseñas
-- incumple las políticas de Google (puede costar la ficha del salón) y la
-- Directiva Ómnibus (RDL 24/2021) lo tipifica como práctica desleal. El
-- patrón legal: valoración 1-5 PRIVADA + el enlace de Google a todos por
-- igual. El incentivo vive en la fidelización, que es legítima.

alter table salons add column google_review_url text;

create table review_requests (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE = idempotencia: una cita pide reseña una sola vez, aunque el
  -- cron pase mil veces.
  booking_id uuid not null unique references bookings(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  sent_at timestamptz,
  -- La nota es del salón, no de Google: si es baja, el dueño tiene la
  -- oportunidad de arreglarlo antes de que sea público.
  rating int check (rating between 1 and 5),
  rated_at timestamptz,
  created_at timestamptz not null default now()
);
create index reviews_customer on review_requests (customer_id);
create index reviews_salon on review_requests (salon_id);

alter table review_requests enable row level security;

-- El cliente valora desde /cita/[token] (service role); el dueño solo lee.
create policy owner_read_reviews on review_requests for select
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

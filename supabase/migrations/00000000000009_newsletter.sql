-- Newsletter del salón. La base de destinatarios NO es "todos los clientes":
-- es marketing_opt_in = true (art. 21 LSSI-CE, consentimiento previo y
-- expreso). La casilla vive en la reserva desde la migración 0006; la lista
-- se construye desde ahí.

create table newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  subject text not null,
  -- Texto plano que la app escapa al montar el HTML. Nunca HTML crudo del
  -- dueño: sería la misma inyección que ya se arregló en lib/email.ts.
  body text not null,
  -- Segmento calculado sobre bookings al enviar: "enfriándose" (clientes que
  -- venían y han dejado de venir) vale más que un masivo a todos.
  segment text not null default 'todos'
    check (segment in ('todos', 'racha', 'enfriandose', 'nuevos')),
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  recipients_count int
);
create index campaigns_salon on newsletter_campaigns (salon_id);
-- El cron busca lo pendiente de procesar sin recorrer el histórico.
create index campaigns_pendientes on newsletter_campaigns (status) where status = 'sending';

create table newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references newsletter_campaigns(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  email text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'bounced', 'complained')),
  sent_at timestamptz,
  -- Idempotencia: un reintento del cron no duplica el envío a nadie.
  unique (campaign_id, customer_id)
);
create index sends_customer on newsletter_sends (customer_id);
create index sends_cola on newsletter_sends (campaign_id) where status = 'queued';

alter table newsletter_campaigns enable row level security;
alter table newsletter_sends enable row level security;

-- Solo el dueño. Ni anon ni clientes tienen nada que ver aquí; el cron entra
-- con service role.
create policy owner_all_campaigns on newsletter_campaigns for all
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

create policy owner_read_sends on newsletter_sends for select
  using (exists (select 1 from newsletter_campaigns c join salons s on s.id = c.salon_id
                 where c.id = campaign_id and s.owner_id = auth.uid()));

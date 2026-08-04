-- Las políticas del dueño dejan de aplicarse a los visitantes anónimos.
--
-- Bug de producción, encontrado el 04-08-2026 probando las fotos de producto:
-- **los productos del salón piloto nunca se han visto en su web**. Con la
-- clave anónima, cualquier lectura de `products` responde
-- «permission denied for table salons».
--
-- La causa es la combinación de dos cosas razonables por separado:
--
--   1. `owner_all_products` es FOR ALL sobre `public`, e incluye
--      `EXISTS (select 1 from salons where ... owner_id = auth.uid())`.
--   2. La migración 0016 recortó el SELECT de `salons` columna a columna, y
--      `owner_id` NO está entre las que puede leer `anon` — con razón: la
--      clave anónima viaja en el navegador.
--
-- Así que para decidir si el visitante es el dueño, Postgres necesita leer
-- una columna que ese visitante tiene prohibida, y la consulta entera muere.
-- No es un fallo de RLS: es un fallo de permisos que ocurre ANTES.
--
-- El arreglo es decir lo que siempre se quiso decir: la política del dueño
-- es para usuarios con sesión. El anónimo se queda con `public_read_*`, que
-- ya filtra por `active` y no mira a `salons` para nada.
--
-- `services` y `employees` tienen exactamente el mismo patrón y hoy
-- funcionan de milagro —el planificador se ahorra evaluar la segunda
-- política cuando la primera ya da verdadero—, así que se arreglan también:
-- que sigan funcionando no puede depender de en qué orden se creó cada una.

-- ── products ──────────────────────────────────────────────────────────
drop policy if exists owner_all_products on products;
create policy owner_all_products on products for all to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ── services ──────────────────────────────────────────────────────────
drop policy if exists owner_all_services on services;
create policy owner_all_services on services for all to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ── employees ─────────────────────────────────────────────────────────
drop policy if exists owner_all_employees on employees;
create policy owner_all_employees on employees for all to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ── review_requests ───────────────────────────────────────────────────
-- Solo lectura del dueño; el cliente valora por RPC con service role.
drop policy if exists owner_read_reviews on review_requests;
create policy owner_read_reviews on review_requests for select to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ── newsletter_campaigns ──────────────────────────────────────────────
drop policy if exists owner_all_campaigns on newsletter_campaigns;
create policy owner_all_campaigns on newsletter_campaigns for all to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

-- ── Y el catálogo de premios de la 0029, por lo mismo ─────────────────
drop policy if exists owner_all_rewards on loyalty_rewards;
create policy owner_all_rewards on loyalty_rewards for all to authenticated
  using (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from salons s where s.id = salon_id and s.owner_id = auth.uid()));

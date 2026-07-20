-- La 0009 habilitó RLS en newsletter_sends pero solo creó la policy de
-- SELECT. El panel encola con la sesión del dueño (app/admin/newsletter/
-- actions.ts:94), así que el INSERT moría con 42501 y ninguna campaña
-- llegaba a salir: se creaba, fallaba al encolar y quedaba en 'failed'.
--
-- El dueño puede encolar envíos de las campañas de SU salón. El cron
-- despacha con service role, que se salta RLS, así que no necesita policy.

create policy owner_insert_sends on newsletter_sends for insert
  with check (
    exists (
      select 1
      from newsletter_campaigns c
      join salons s on s.id = c.salon_id
      where c.id = campaign_id and s.owner_id = auth.uid()
    )
  );

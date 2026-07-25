-- La tabla de salones dejaba de ser un censo público.
--
-- `public_read_salons using (true)` no restringe columnas, y desde la 0001
-- se han ido añadiendo: stripe_account_id, owner_id, charges_enabled,
-- blocked, modules… Con la clave anónima (que va en el JS del navegador)
-- cualquiera se descargaba la lista completa de clientes de la plataforma
-- con la cuenta de Stripe de cada uno.
--
-- RLS no filtra columnas, pero los GRANT sí: se le deja a `anon` solo lo
-- que la web pública necesita enseñar. Lo demás pasa a leerse con service
-- role desde el servidor.
--
-- ponytail: `authenticated` conserva el acceso completo porque el panel del
-- dueño lo necesita y un GRANT no distingue dueño de cliente con cuenta.
-- El salto de anon a authenticated exige registrarse, así que ya no es
-- "cualquiera con la clave del bundle". Separar del todo pide una vista
-- pública, y eso es refactor de otro día.
revoke select on salons from anon;
grant select (
  id, name, slug, phone, address, timezone, logo_url, custom_domain
) on salons to anon;

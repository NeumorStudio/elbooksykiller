-- Conserva la cadencia, el destino y la autorización del job de newsletter.
-- Una campaña en `sending` sin destinatarios pendientes también necesita
-- una pasada: el endpoint es quien la marca como terminada.
do $migration$
declare
  job record;
  marca constant text := '/* salonio: newsletter solo con campanas */';
begin
  -- En entornos sin pg_cron o sin el job, no se provisiona ningún disparador.
  if to_regclass('cron.job') is null then
    return;
  end if;

  for job in
    select j.jobid, j.command
    from cron.job j
    where j.database = current_database()
      and j.command like '%/api/cron/newsletter%'
      and strpos(j.command, marca) = 0
  loop
    perform cron.alter_job(
      job.jobid,
      command := format('%s DO %L;', marca, format(
        $body$
        begin
          if exists (select 1 from public.newsletter_campaigns where status = 'sending') then
            execute %L;
          end if;
        end;
        $body$,
        job.command
      ))
    );
  end loop;
end;
$migration$;

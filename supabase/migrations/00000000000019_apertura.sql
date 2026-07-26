-- Fecha de apertura del salón.
--
-- Un salón que aún no ha abierto necesita repartir su enlace ANTES de abrir
-- —el cartel, el Instagram, el boca a boca empiezan días antes— pero no
-- puede aceptar citas para mañana. Bloquear los huecos a secas no vale: el
-- cliente ve «no queda hueco, suelen llenarse rápido» y entiende justo lo
-- contrario, que está lleno.
--
-- Con la fecha, la web puede decir la verdad: «Abrimos el 1 de agosto».
--
-- `date` y no `timestamptz`: se abre un día, no a una hora. Se interpreta en
-- la zona del salón, igual que el resto de la agenda.
alter table salons add column opens_at date;

comment on column salons.opens_at is
  'Primer día en que se aceptan citas. NULL = ya está abierto. Se ignora sola cuando pasa la fecha.';

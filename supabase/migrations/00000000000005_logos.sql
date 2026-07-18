-- Logo por salón: bucket público de lectura; las escrituras van por
-- server action con service role (sin políticas de escritura anónimas).
alter table salons add column logo_url text;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

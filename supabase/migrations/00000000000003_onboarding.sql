-- Checklist de bienvenida: se muestra hasta que el dueño la despide.
alter table salons add column onboarded boolean not null default false;

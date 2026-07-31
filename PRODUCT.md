# Product

## Register

product

## Platform

web

## Users

Dos audiencias con superficies separadas. El cliente final de la peluquería reserva desde el móvil (en el sofá, al salir del trabajo, de noche); quiere ver huecos y confirmar en menos de un minuto, sin registrarse. El dueño/peluquero gestiona desde `/admin` entre cliente y cliente, en el local con luz de trabajo: consulta la agenda de un vistazo, cancela, ajusta horarios y servicios.

## Product Purpose

SaaS multi-tenant de reservas para peluquerías y barberías españolas. Cada salón tiene su web pública de reservas (`/[slug]`, y dominio propio si lo trae: el piloto ya sirve desde `payevillalobos.neumorstudio.com`, y ese dominio es el que manda en el canonical) y un panel de gestión. Éxito: el dueño deja de coger el teléfono para dar citas y el cliente final prefiere reservar aquí antes que llamar.

## Positioning

La web ES de la peluquería, no un marketplace: sin comisiones por cita, sin competidores al lado, sin marca ajena delante del cliente.

## Brand Personality

Con oficio, cálido, de autor. La web pública debe sentirse como una barbería con carácter: tonos miel/latón sobre oscuro cálido, tipografía con presencia. El panel admin es sobrio y eficiente; el carácter aparece solo en acentos.

## Anti-references

- Booksy/Fresha: sensación de agregador, listados densos, banners, la marca de la plataforma por encima del salón.
- SaaS corporativo: dashboard azul frío, gráficos decorativos.
- Plantilla de WordPress: hero con foto de stock, secciones infinitas, carruseles.

## Design Principles

1. La reserva en menos de un minuto: cada paso del flujo público elimina fricción, nunca la añade.
2. El salón es el protagonista: la plataforma desaparece; el nombre y el oficio del salón llevan la escena.
3. El admin se lee de un vistazo: agenda y números legibles a distancia de brazo, entre dos cortes.
4. Un solo vocabulario de componentes: mismo botón, mismo input, mismo estado en todas las pantallas.
5. Familiaridad ganada: patrones estándar donde el usuario está en tarea; el carácter vive en color y tipografía, no en affordances inventadas.

## Accessibility & Inclusion

WCAG AA como suelo: contraste ≥4.5:1 en texto (público incluye clientes de más edad), targets táctiles ≥44px en el flujo móvil, `prefers-reduced-motion` respetado en toda animación.

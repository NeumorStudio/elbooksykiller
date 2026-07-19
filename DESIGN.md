# Design

## Tema

Dos escenas sobre los mismos tokens semánticos (`app/globals.css`):

- **Escaparate** (`:root`): landing y web pública del salón.
- **Taller** (`.taller`): el panel del dueño. Misma casa, sin los focos.

## Color (OKLCH)

Carbón neutro, elegido POR el neumorfismo: el relieve necesita un tono medio donde quepan las dos sombras. Sobre un casi-negro la sombra clara no tiene recorrido y el efecto no se ve.

| Token | Escaparate (`:root`) | Taller (`.taller`) |
|---|---|---|
| `--bg` | `oklch(0.285 0.006 265)` | `oklch(0.255 0.005 265)` |
| `--surface` | **igual que `--bg`** | **igual que `--bg`** |
| `--surface-2` / `-3` | `0.325` / `0.365` | `0.295` / `0.335` |
| `--ink` | `oklch(0.95 0.004 265)` | `oklch(0.93 0.004 265)` |
| `--muted` / `--faint` | `0.755` / `0.63` | `0.74` / `0.61` |
| `--line` | `oklch(1 0 0 / 0.07)` | ídem |
| `--brand` | `oklch(0.8 0.135 82)` oro | `oklch(0.8 0.105 82)` oro desat. ~20% |
| `--neu-luz` / `--neu-sombra` | `1 0 0 / 0.07` · `0 0 0 / 0.42` | `/ 0.055` · `/ 0.36` |

`--surface` **es** `--bg` a propósito: en neumorfismo la pieza se extruye del propio fondo. El volumen lo crean las sombras, no un color de tarjeta distinto. Si alguien las separa, el estilo deja de existir.

El taller va un punto más oscuro y con el oro desaturado y el relieve más plano: se mira ocho horas, no cuarenta segundos.

## Tipografía

- **Display**: Fraunces (`--font-display`) — nombres de salón, títulos, numerales de paso.
- **UI/body**: Geist Sans (`--font-sans`) — todo lo demás. Escala fija en rem.
- `.display-xl` / `.display-l` usan `clamp()`: excepción deliberada al "sin clamp" del sistema, solo en escaparate, donde la escala extrema ES el diseño.

## Neumorfismo

`.neu` / `.neu-sm` (extruido) y `.neu-in` (hundido: inputs y datos). Dos sombras opuestas simulan luz desde arriba-izquierda.

**Regla de accesibilidad, no negociable:** un borde difuminado no cumple el 3:1 que WCAG 1.4.11 exige a los componentes. Por eso cada pieza lleva ADEMÁS borde de 1px, y lo seleccionado se marca con **relleno de color**, nunca solo con relieve.

## Componentes (`@layer components` en `globals.css`)

- `.btn-primary` (oro) · `.btn-quiet` (borde) · `.btn-danger` — min 44px, relieve que se hunde en `:active`.
- `.field` + `.label` — label siempre visible, `.neu-in`.
- `.chip` / `.chip-on` — selección (días, horas, profesionales).
- `.panel` / `.tarjeta` — superficies (`rounded-2xl`); `.tarjeta-int` añade hover solo en punteros finos.
- `.pasada` — opacidad 0.45: la agenda se consume a lo largo del día.
- `.plato-logo` — plato blanco para logos con fondo propio (ver abajo).
- `.rotulo` — versalitas espaciadas con regla. `.solapa` — secciones que se solapan en superficie continua.
- `.fade-x` / `.fade-x-solo-movil` — máscara que avisa de que una tira horizontal continúa; sin ella el último elemento visible parece el último que hay.

Foco: `outline` (no `box-shadow`) con `outline-offset: 3px`, y **aparece instantáneo** — solo se anima la separación.

## Logos de salón

`.plato-logo` — plato blanco redondeado bajo el logo. El caso típico (lettering negro sobre fondo blanco opaco, p. ej. Paye Villalobos) no se puede hacer transparente: el blanco es estructural, rellena barba y letras. Sobre oscuro sería un ladrillo; sobre plato es un rótulo intencionado — el óvalo blanco con letra negra ES el lenguaje del cartel de barbería americana. Regla: por debajo de ~100px el lettering completo es una mancha (favicon/PWA usan inicial o emblema).

## Motion

Escala corta y sesgada a rápido, con asimetría deliberada — lo que entra tarda más que lo que sale, porque el usuario ya decidió:

`--d-instant` 80ms · `--d-fast` 150ms · `--d-base` 210ms · `--d-slow` 300ms. Curvas de Material 3: `--e-out` (entrar), `--e-in` (salir), `--e-both`.

**Dos zonas con reglas opuestas.** El escaparate puede tener scroll conectado; el flujo de reserva y el panel, cero efectos de scroll — ahí el movimiento va en micro-interacciones (`:active`, foco, cambios de estado). Motion de app ≠ motion de landing.

Técnicas de escaparate, todas CSS nativo (0 KB de JS):

- `.pila` — apilado pegajoso (`sticky` escalonado, soporte universal).
- `.revelar` — aparición ligada a `view()`, corta (NN/g: >500ms se salta el texto), de una sola vez.
- `.zoom-lento` — Ken Burns ligado al scroll, solo `scale`. Nunca sobre el LCP.
- `.hero-cede` — el hero se hunde cuando la sección siguiente pasa por encima.

Reglas duras: el estado final es el estado por defecto (iOS < 26 no soporta `view()` y debe ver la página entera); los bloques scroll-driven van en CSS plano (la shorthand `animation` resetea `animation-timeline` y Tailwind no garantiza el orden); gate doble `prefers-reduced-motion: no-preference` + `@supports` (patrón C39 del W3C: si algo falla, el fallo seguro es "sin animación"); nada de scroll-jacking ni snap `mandatory`. Los `position: fixed` viven fuera de cualquier árbol con `transform`.

## Imagen

La IA (`scripts/nanobanana.mjs`, `scripts/kling.mjs`) genera **atmósfera y estados vacíos** — nunca el salón concreto, ni el trabajo del salón, ni personas presentadas como el equipo. El cliente lo descubre al cruzar la puerta.

En `public/`: `hero-loop.mp4` / `.webm` + `hero-poster.webp` (vídeo ambiental), `vacio-404.webp` y `agenda-vacia.webp` (line-art de estados vacíos). El póster es el LCP, nunca el vídeo.

La foto real del local y de los cortes es siempre preferible: la ilustración es voz, la fotografía es prueba.

## Layout

- **Pública**: una columna, `max-w-xl`, flujo vertical de pasos numerados. Cabecera con estado de apertura en vivo ("Abierto ahora · hasta las 20:00", calculado de `working_hours` en la TZ del salón), horario semanal y "Cómo llegar". CTA de reserva arriba.
- **Pública con `?desde=local`** (QR del local): sin vídeo, galería ni dirección. Quien escanea ya está sentado en la silla.
- **Panel**: nav superior sticky, `max-w-4xl`. Agenda en tres capas (hoy · mes por densidad · día por profesional), caja del día siempre visible, horas en `tabular-nums`.

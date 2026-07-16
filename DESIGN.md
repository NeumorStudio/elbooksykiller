# Design

## Theme

Dos escenas sobre los mismos tokens semánticos (`app/globals.css`):

- **Noche** (`:root`, web pública + landing): oscuro cálido de barbería. Fondo casi negro con matiz ámbar, oro/miel como color de marca.
- **Día** (`.day`, panel admin): claro y sobrio; el ámbar solo en acentos y acciones primarias.

## Color (OKLCH)

| Token | Noche (público) | Día (admin) |
|---|---|---|
| `--bg` | `oklch(0.155 0.012 75)` | `oklch(1 0 0)` |
| `--surface` | `oklch(0.20 0.014 75)` | `oklch(0.972 0.003 80)` |
| `--ink` | `oklch(0.94 0.012 85)` | `oklch(0.22 0.012 75)` |
| `--muted` | `oklch(0.72 0.02 80)` | `oklch(0.45 0.015 75)` |
| `--line` | `oklch(0.31 0.018 75)` | `oklch(0.89 0.006 80)` |
| `--brand` | `oklch(0.78 0.14 82)` oro miel | `oklch(0.53 0.125 75)` ocre |
| `--danger` / `--ok` | rojo/verde adaptados por escena | ídem |

Estrategia: restrained en admin (acento ≤10%), committed en la pública (el oro lleva identidad en display + selecciones). Contraste AA verificado en ambas escenas.

## Typography

- **Display**: Fraunces (variable, `--font-display`) — nombres de salón, títulos de página, numerales de paso. Letter-spacing -0.02em máx.
- **UI/body**: Geist Sans (`--font-sans`) — todo lo demás. Escala fija rem, sin clamp.
- Contraste de par: serif con carácter + sans neutra.

## Components (vocabulario único, en `globals.css @layer components`)

- `.btn-primary` (oro, brand-ink), `.btn-quiet` (borde), `.btn-danger` (texto rojo, hover tinte) — min-height 44px, focus ring `outline-brand`.
- `.field` + `.label` — inputs con label visible siempre, focus por borde brand.
- `.chip` / `.chip-on` — selección (días, horas, profesionales).
- `.panel` — contenedor: borde + surface, radius 12px (`rounded-xl`). Sin sombras decorativas.

## Motion

150ms `transition-colors` en interactivos. Skeleton pulse en carga de huecos. Sin animaciones de entrada. `prefers-reduced-motion` anula todo.

## Layout

- Pública: una columna, max-w-xl, flujo vertical de 4 pasos numerados (secuencia real).
- Admin: nav superior sticky, contenido max-w-4xl; agenda agrupada por día con hora en tabular-nums.

# Salonio

SaaS de reservas para peluquerías y barberías. Cada salón tiene su web pública
(`/[slug]`, o su propio dominio si lo trae) y un panel de gestión en `/admin`:
agenda, servicios, equipo, clientes, fidelización y newsletter.

La web **es** de la peluquería, no un marketplace: sin comisiones por cita y sin
marca ajena delante del cliente.

En producción: [reservas.neumorstudio.com](https://reservas.neumorstudio.com).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase
(Postgres + Auth + RLS) · Resend para el correo · Stripe para los pagos ·
`web-push` para los avisos. Desplegado en Vercel.

El gestor de paquetes es **npm** — hay `package-lock.json`, no mezclar con pnpm
ni bun.

## Arrancar en local

```bash
npm install
cp .env.example .env.local   # y pedir las claves al dueño del repo
npm run dev
```

En `.env.local` la variable que decide todo es **`BD`**: `BD=dev` apunta a la
base de pruebas y `BD=prod` a la de clientes reales. Déjala en `dev`.

```bash
npm run build     # compilar
npm run backup    # copia de la base de producción
```

## Antes de tocar nada

Hay un cliente real cogiendo citas, y dos bases de datos que es fácil confundir.
Léete esto en este orden:

| Documento | Qué cuenta |
|---|---|
| [`docs/ONBOARDING_DEV.md`](docs/ONBOARDING_DEV.md) | Las dos ramas, las dos bases y el flujo. **Empieza aquí.** |
| [`CLAUDE.md`](CLAUDE.md) | Las trampas conocidas — incluidos dos scripts que escriben en producción ignorando `BD` |
| [`docs/CRONS.md`](docs/CRONS.md) | Los cuatro crons, que corren en `pg_cron` y no en Vercel |
| [`docs/CORREO.md`](docs/CORREO.md) | Resend: una clave por entorno, y las dos son de solo envío |
| [`DESIGN.md`](DESIGN.md) | Tokens, neumorfismo y las reglas de movimiento |
| [`PRODUCT.md`](PRODUCT.md) | A quién sirve y contra qué se posiciona |
| [`AGENTS.md`](AGENTS.md) | Este Next no es el que conoces: leer sus docs antes de escribir |

El esquema vive en `supabase/migrations/`. Las migraciones se aplican **siempre
en dev primero**, nunca a mano en producción.

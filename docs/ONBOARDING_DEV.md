# Bienvenido — cómo trabajamos aquí

Léete esto entero antes del primer commit. Son cinco minutos y te ahorra el
único error caro que se puede cometer en este repo: escribir en la base de
datos equivocada.

---

## 1. Dos ramas

| Rama | Qué es | A dónde despliega |
|---|---|---|
| `dev` | Donde se trabaja. Todo empieza aquí. | Preview de Vercel |
| `main` | Lo que está en producción. | `reservas.neumorstudio.com` |

No hay más ramas y no queremos más. Si creas una rama propia su preview
apunta a la base de **producción** (ver el aviso del apartado 5), así que
trabaja en `dev`.

## 2. Dos bases de datos

Son dos proyectos de Supabase distintos, con datos distintos:

| | Ref | Quién la usa |
|---|---|---|
| **dev** | `cjyfbmyidqubqikkbvpx` | La rama `dev`, su preview, y tu `npm run dev` |
| **prod** | `vgwhornipwxicyfknafm` | `main` y el dominio público |

Las dos tienen **el mismo esquema** — las 25 migraciones de
`supabase/migrations/` aplicadas y verificadas (31-07-2026). Lo que cambia son
los datos.

Esos dos refs son los únicos válidos. Antes de escribir en cualquier base,
comprueba con `get_project_url` que estás donde crees.

## 3. El dominio

`reservas.neumorstudio.com` es la plataforma en producción. Sale de la rama
`main` y habla con la base de prod.

**Ahí no se prueba.** Se probó hasta el 30-07-2026, y desde ese día no: el
salón de pruebas que había en producción quedó `blocked` porque cada reserva
gasta correos de una cuota compartida de 100 al día, y cualquiera que supiera
la URL podía dejar sin avisos a la peluquería de verdad. **Las pruebas van a la
base de dev**, que para eso está.

De lo que hay en producción, el salón «Paye Villalobos», su ficha y sus
servicios son **datos buenos** — el primer cliente real entra el **7 de agosto
de 2026**. No los toques.

Los correos salen de `citas@neumorstudio.com` (Resend, dominio verificado). Es
decir: **desde local puedes enviar correo de verdad a gente de verdad.**

---

## 4. Lo primero — el MCP de Supabase en tu Claude Code

El repo trae `.mcp.json` con **dos** servidores ya configurados. Al abrir el
proyecto, Claude Code te pedirá aprobarlos:

| Servidor | Tools | Base |
|---|---|---|
| `supabase` | `mcp__supabase__*` | **producción** |
| `supabase-dev` | `mcp__supabase-dev__*` | dev |

El del nombre sin sufijo es el de producción. Es a propósito: tienes que ver el
sufijo `-dev` para saber que estás en la base segura.

Cada uno pide su propio OAuth por separado. Pídele a Claude que llame a
`authenticate` en el que falte y abre la URL que te dé.

Necesitas que te hayan invitado antes a la organización de Supabase. Si al
autorizar no ves los proyectos, es eso; pide acceso.

### Poner en marcha en local

```bash
npm install
cp .env.example .env.local
npm run dev
```

En `.env.local` la variable que decide todo es **`BD`**:

```bash
BD=dev     # base de pruebas  ← déjala así
BD=prod    # clientes reales
```

Con `BD=dev` manda el par `SUPABASE_DEV_*`. Si no pones la variable, manda lo
que haya en `NEXT_PUBLIC_SUPABASE_*`, que puede ser producción. Ponla.

Las claves te las tiene que pasar el dueño del repo; `.env.local` no está en
git.

---

## 5. El flujo

```
commit → dev
   ↓
preview de Vercel + base de dev
   ↓  (probado y validado)
merge dev → main
   ↓
reservas.neumorstudio.com + base de prod
```

Se trabaja en `dev`, se comprueba en el preview —que ya apunta solo a la base de
dev— y cuando funciona se mergea. A `main` no se commitea directamente.

**`main` no está protegida y no exige PR**: se decidió así el 30-07-2026, porque
sois dos y la ceremonia estorbaba más de lo que aportaba. Es una convención, no
una barrera técnica — lo cual quiere decir que la disciplina la pones tú.

Y ya no hay criterio suelto: producción tiene un cliente real con su ficha y sus
servicios, y el salón de pruebas que había está cerrado. Lo que se prueba, se
prueba en dev.

### Las migraciones no se aplican a mano

Van por el MCP, no por `supabase db push`, y siempre **en dev primero**. El
orden es: escribir el `.sql` en `supabase/migrations/`, aplicarlo en dev,
comprobar que funciona, y solo entonces en prod.

### Dos avisos con nombre y apellido

- **Las variables de Preview genéricas de Vercel apuntan a producción.** Solo
  la rama `dev` tiene las suyas propias hacia la base de dev. Una rama nueva
  hereda las genéricas y su preview escribe en prod. Por eso: `dev` y ya.
- **Stripe y Resend en Preview son los de producción.** Un preview cobra de
  verdad y manda correos de verdad. Ojo con los formularios de reserva al
  probar.

---

## 6. Antes de escribir código

`AGENTS.md` (que Claude Code lee solo) dice algo que va en serio: **este Next
no es el que conoces.** Es la 16.2, con cambios de API y de convenciones
respecto a lo que las IAs tienen aprendido. Los docs de la versión exacta están
en `node_modules/next/dist/docs/` — que los lea antes de escribir, no después
de que falle el build.

---

## 7. Qué se movió el 4 de agosto de 2026

Una tanda grande, toda en producción y con el piloto ya cogiendo citas. Por si
te encuentras algo que ayer no estaba:

**Migraciones nuevas — de la 0026 a la 0031.** Todas aditivas, ninguna toca
datos existentes:

| | Qué añade |
|---|---|
| `0026` | Quién canceló y cuándo, y el recuento de cancelaciones a última hora |
| `0027` | `reminders`: qué aviso se ha mandado ya de cada cita |
| `0028` | El push puede ser de un cliente **o** de una cuenta (el dueño) |
| `0029` | `loyalty_rewards`: varios premios por salón |
| `0030` | Las políticas de dueño pasan a `TO authenticated` — arregla un fallo real |
| `0031` | Los premios son escalones por visitas acumuladas, no monedas que se gastan |

**Lo que cambió de comportamiento:**

- Cancelar desde el enlace: el margen baja a **1 hora** y vive en `lib/cancelacion.ts`.
- **Dos recordatorios** por cita (la víspera y una hora antes) en el mismo cron.
- El **autocompletado** espera 12 horas en vez de 3, y la agenda ya no esconde
  las citas cerradas: se pueden marcar y corregir cuando haga falta.
- Se puede **mover una cita** sin cancelarla, y mandarla **por WhatsApp** al
  cliente desde el panel.
- El dueño puede recibir sus avisos **en el móvil**; si los activa, dejan de
  llegarle por correo.
- Los **productos ya se ven en la web** del salón (los rompía la política de la
  0030) y admiten foto.
- Cada salón lleva **su logo en la pestaña** del navegador.

**Lo que quedó pendiente y está apuntado en `CLAUDE.md`:** el tope de 4 citas
futuras por teléfono aplicándose al panel, el `sessionStorage` de la
confirmación, y el nombre del producto.

---

## 8. Documentos vecinos

- `docs/CRONS.md` — los cuatro crons y sus frecuencias.
- `docs/CORREO.md` — Resend: qué clave usa cada entorno y por qué son de solo envío.
- `CLAUDE.md` — las trampas conocidas. Léelas antes de ejecutar cualquier script
  de `scripts/`: dos de ellos escriben en producción se ponga lo que se ponga en
  `BD`.

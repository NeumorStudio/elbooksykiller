# Manual de puesta en marcha del cliente

Lo que se le envía a una peluquería nueva junto con su correo y su contraseña.
Le lleva de la primera entrada a la primera reserva sin que tenga que
preguntarnos nada.

| Fichero | Qué es |
|---|---|
| `MANUAL.pdf` | **Lo que se envía.** A4, 20 páginas. |
| `MANUAL.html` | Lo mismo, un solo fichero con las capturas dentro. Se abre en cualquier navegador y se imprime con Ctrl+P. |
| `plantilla.html` | La fuente. **Aquí es donde se edita el texto**, no en `MANUAL.html`. |
| `construir.mjs` | Mete las capturas en la plantilla y escribe `MANUAL.html`. |
| `capturas/` | Las diez capturas, en WebP a 1200px. |
| `salon-demo.mjs` | Crea el salón de demostración en la base de **dev** para poder rehacer capturas. |

## Cambiar el texto

```bash
# 1. editar plantilla.html
node construir.mjs                                    # → MANUAL.html
google-chrome --headless --no-pdf-header-footer \
  --print-to-pdf=MANUAL.pdf file://$PWD/MANUAL.html   # → MANUAL.pdf
```

## Rehacer las capturas

Salen de un salón vacío en la base de **dev**, nunca de producción y nunca del
salón piloto. El dueño de demostración no puede ser el superadmin: a ese el
panel le enseña el menú de super y no el de un salón normal.

```bash
node salon-demo.mjs        # crea onboarding-demo@salonio.test + "Peluquería Ejemplo"
npm run build && npm start # modo producción: en dev, Turbopack peta al navegar
```

Luego se recorre el panel con Playwright y se guardan en `capturas/` en WebP a
1200px de ancho. Al terminar, **borrar el salón de demostración de dev**.

Dos cosas que se arreglan al recortar, no en el navegador:

- La pantalla de entrada sale con mucho hueco vertical: se recorta a la zona
  del formulario.
- «Mi web» enseña arriba la dirección sacada de la cabecera `Host`, que en
  local es `localhost:3000`. Esa tarjeta se recorta y la dirección se explica
  en el texto.

## Pendiente

El manual dice que la contraseña **no se puede cambiar ni recuperar** desde el
panel, porque hoy es verdad: `/admin/login` solo hace `signInWithPassword`, y no
hay ni «olvidé mi contraseña» ni cambio desde dentro. Es el único punto en el
que el cliente tiene que escribirnos. Cuando exista, hay que quitar el aviso de
la sección 1 y la fila de «Si algo no va».

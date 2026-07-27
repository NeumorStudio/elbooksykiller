#!/usr/bin/env bash
#
# Dispara los crons de elbooksykiller desde un servidor propio.
#
# Por qué: el plan Hobby de Vercel solo admite crons una vez al día, y los
# nuestros necesitan correr cada hora o cada cuarto de hora. Al quitarlos de
# vercel.json (commit c38fdba) los cuatro endpoints se quedaron sin
# disparador: existen y funcionan, pero nadie los llama.
#
# INSTALACIÓN (como root en el droplet):
#
#   1. Copiar este script:
#        install -m 755 cron-droplet.sh /usr/local/bin/elbooksykiller-cron.sh
#
#   2. Crear el archivo de entorno con el CRON_SECRET que hay en Vercel:
#        printf 'CRON_SECRET=el-valor-real\n' > /etc/elbooksykiller.env
#        chmod 600 /etc/elbooksykiller.env
#
#   3. Registrar en crontab -e (mismos horarios que tenía vercel.json):
#        0  * * * * /usr/local/bin/elbooksykiller-cron.sh recordatorios
#        30 * * * * /usr/local/bin/elbooksykiller-cron.sh autocompletar
#        45 * * * * /usr/local/bin/elbooksykiller-cron.sh resenas
#        */15 * * * * /usr/local/bin/elbooksykiller-cron.sh newsletter
#
#   4. Comprobar:  /usr/local/bin/elbooksykiller-cron.sh newsletter
#
# Los cuatro endpoints exportan GET. Con POST devuelven 405.
set -euo pipefail

ENV_FILE=/etc/elbooksykiller.env
if [ ! -f "$ENV_FILE" ]; then
  echo "falta $ENV_FILE con la línea CRON_SECRET=..." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${CRON_SECRET:?CRON_SECRET vacío en $ENV_FILE}"
BASE="${BASE_URL:-https://elbooksykiller-sigma.vercel.app}"

ENDPOINT="${1:?uso: $0 <recordatorios|autocompletar|resenas|newsletter>}"
case "$ENDPOINT" in
  recordatorios|autocompletar|resenas|newsletter) ;;
  *) echo "endpoint desconocido: $ENDPOINT" >&2; exit 2 ;;
esac

# -f para que un 4xx/5xx sea fallo; el cuerpo va al log para poder auditar
# cuántos envíos salieron y cuántos fallaron.
if RESP=$(curl -fsS -m 120 \
      -H "Authorization: Bearer $CRON_SECRET" \
      "$BASE/api/cron/$ENDPOINT"); then
  echo "[$(date -Is)] $ENDPOINT ok $RESP"
else
  echo "[$(date -Is)] $ENDPOINT FALLO" >&2
  exit 1
fi

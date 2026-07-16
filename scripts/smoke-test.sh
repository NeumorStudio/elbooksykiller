#!/usr/bin/env bash
# Smoke test E2E del backend: falla (exit != 0) si el flujo de reservas se rompe.
# Uso: ./scripts/smoke-test.sh  (lee .env.local)
set -euo pipefail
cd "$(dirname "$0")/.."

export $(grep -v '^#' .env.local | xargs)
URL=$NEXT_PUBLIC_SUPABASE_URL
KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
TS=$(date +%s)
EMAIL="smoke-$TS@test.local"
DAY=$(date -d "next monday" +%F)

jqpy() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "1. signup $EMAIL"
RESP=$(curl -sf "$URL/auth/v1/signup" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"test123456\"}")
JWT=$(echo "$RESP" | jqpy "['access_token']")
USRID=$(echo "$RESP" | jqpy "['user']['id']")

auth() { curl -sf "$URL/rest/v1/$1" -H "apikey: $KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" "${@:2}"; }
anon() { curl -s "$URL/rest/v1/$1" -H "apikey: $KEY" -H "Content-Type: application/json" "${@:2}"; }

echo "2. crear salón, empleado, servicio, horario"
SALON=$(auth "salons" -d "{\"owner_id\":\"$USRID\",\"name\":\"Smoke Barber $TS\",\"slug\":\"smoke-$TS\"}" | jqpy "[0]['id']")
EMP=$(auth "employees" -d "{\"salon_id\":\"$SALON\",\"name\":\"Paco\"}" | jqpy "[0]['id']")
SVC=$(auth "services" -d "{\"salon_id\":\"$SALON\",\"name\":\"Corte\",\"price_cents\":1500,\"duration_min\":30}" | jqpy "[0]['id']")
auth "working_hours" -d "{\"employee_id\":\"$EMP\",\"weekday\":1,\"start_min\":600,\"end_min\":840}" > /dev/null

echo "3. disponibilidad para $DAY (lunes)"
SLOTS=$(anon "rpc/available_slots" -d "{\"p_employee\":\"$EMP\",\"p_service\":\"$SVC\",\"p_day\":\"$DAY\"}")
N=$(echo "$SLOTS" | jqpy ".__len__()")
SLOT=$(echo "$SLOTS" | jqpy "[0]")
[ "$N" -gt 0 ] || { echo "FAIL: sin huecos"; exit 1; }
echo "   $N huecos, primero: $SLOT"

echo "4. reservar"
BOOKING=$(anon "rpc/create_booking" -d "{\"p_employee\":\"$EMP\",\"p_service\":\"$SVC\",\"p_start\":\"$SLOT\",\"p_name\":\"Cliente Test\",\"p_phone\":\"600000000\"}")
echo "$BOOKING" | grep -q '"' || { echo "FAIL: reserva no creada: $BOOKING"; exit 1; }

echo "5. mismo hueco otra vez -> debe fallar"
DUP=$(anon "rpc/create_booking" -d "{\"p_employee\":\"$EMP\",\"p_service\":\"$SVC\",\"p_start\":\"$SLOT\",\"p_name\":\"Otro\",\"p_phone\":\"600000001\"}")
echo "$DUP" | grep -q slot_unavailable || { echo "FAIL: reserva duplicada aceptada: $DUP"; exit 1; }

echo "6. el hueco ya no se ofrece"
anon "rpc/available_slots" -d "{\"p_employee\":\"$EMP\",\"p_service\":\"$SVC\",\"p_day\":\"$DAY\"}" \
  | grep -qF "$SLOT" && { echo "FAIL: hueco reservado sigue ofertado"; exit 1; }

echo "7. RLS: anon no ve bookings, el dueño sí"
[ "$(anon "bookings?select=id")" = "[]" ] || { echo "FAIL: anon puede leer bookings"; exit 1; }
OWN=$(auth "bookings?select=id,customer_name" | jqpy ".__len__()")
[ "$OWN" -eq 1 ] || { echo "FAIL: dueño no ve su reserva"; exit 1; }

echo "8. limpieza"
auth "salons?id=eq.$SALON" -X DELETE > /dev/null
curl -sf "$URL/auth/v1/user" -X DELETE -H "apikey: $KEY" -H "Authorization: Bearer $JWT" > /dev/null 2>&1 || true

echo "SMOKE TEST OK ✅"

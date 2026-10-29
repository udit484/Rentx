#!/usr/bin/env bash
set -Eeuo pipefail
COMPOSE=(docker compose -f docker-compose.ci.yml)

cleanup() {
  rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    "${COMPOSE[@]}" logs --no-color || true
  fi
  "${COMPOSE[@]}" down --volumes --remove-orphans || true
  exit "$rc"
}
trap cleanup EXIT

"${COMPOSE[@]}" up --build --detach --wait --wait-timeout 240
curl -fsS http://127.0.0.1:8080/health

EMAIL="ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}@example.com"
PASSWORD='RentxCIpassword123!'

status=$(curl -sS -o /tmp/rentx-register.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8080/api/auth/register \
  --data "{\"name\":\"CI Owner\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"owner\"}")

if [ "$status" != "201" ]; then
  cat /tmp/rentx-register.json
  echo "Registration smoke test returned HTTP $status"
  exit 1
fi

TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8080/api/auth/login \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -er '.token')

for path in \
  /api/auth/me /api/users/me /api/products /api/owner/products \
  /api/bookings /api/owner/bookings /api/payments \
  /api/notifications /api/wishlist; do
  echo "Checking $path"
  curl -fsS -o /dev/null \
    -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:8080$path"
done

echo "RentX container integration smoke tests passed."

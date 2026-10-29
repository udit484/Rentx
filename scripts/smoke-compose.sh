#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE=(docker compose -f docker-compose.ci.yml)
BASE=http://127.0.0.1:8080

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

request() {
  local label="$1" expected="$2" response="$3"
  shift 3
  local status
  status=$(curl -sS -o "$response" -w '%{http_code}' "$@") || {
    echo "FAILED: $label (connection failure)"
    return 1
  }
  if [ "$status" != "$expected" ]; then
    echo "FAILED: $label — expected HTTP $expected, got $status"
    cat "$response"
    echo
    return 1
  fi
  echo "PASS: $label (HTTP $status)"
}

register_and_login() {
  local role="$1"
  local email="ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${role}@example.com"
  local password='RentxCIpassword123!'
  local body="/tmp/rentx-${role}.json"

  request "$role registration" 201 "$body" \
    -H 'Content-Type: application/json' \
    -X POST "$BASE/api/auth/register" \
    --data "{\"name\":\"CI ${role}\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}"

  request "$role login" 200 "$body" \
    -H 'Content-Type: application/json' \
    -X POST "$BASE/api/auth/login" \
    --data "{\"email\":\"$email\",\"password\":\"$password\"}"

  jq -er '.token' "$body"
}

echo "Starting disposable RentX stack..."
"${COMPOSE[@]}" up --build --detach --wait --wait-timeout 240

request "Frontend health" 200 /tmp/rentx-health.txt "$BASE/health"

OWNER_TOKEN="$(register_and_login owner)"
RENTER_TOKEN="$(register_and_login renter)"

check_api() {
  local label="$1" token="$2" path="$3"
  request "$label" 200 "/tmp/rentx-response.json" \
    -H "Authorization: Bearer $token" "$BASE$path"
}

check_api "Auth profile" "$OWNER_TOKEN" "/api/auth/me"
check_api "Owner profile" "$OWNER_TOKEN" "/api/users/me"
check_api "Public product search" "$OWNER_TOKEN" "/api/products"
check_api "Owner inventory" "$OWNER_TOKEN" "/api/owner/products"
check_api "Owner booking requests" "$OWNER_TOKEN" "/api/owner/bookings"

check_api "Renter profile" "$RENTER_TOKEN" "/api/users/me"
check_api "Renter bookings" "$RENTER_TOKEN" "/api/bookings"
check_api "Payment history" "$RENTER_TOKEN" "/api/payments"
check_api "Notifications" "$RENTER_TOKEN" "/api/notifications"
check_api "Wishlist" "$RENTER_TOKEN" "/api/wishlist"

echo "All RentX container integration smoke checks passed."

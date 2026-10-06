#!/usr/bin/env bash
# Post-deploy smoke checks for dokan-v3 — owner deliverables R2.
#
# Read-only EXCEPT the two order checks, which are gated behind SMOKE_ALLOW_WRITES=1 because they
# create a real order in whatever store you point them at. Run them against a test store, or accept
# that you will delete the order afterwards (the script prints its id).
#
#   BASE_URL=https://dokanstore.xyz \
#   SMOKE_SLUG=estikana SMOKE_TABLE=table-1 SMOKE_TABLE_TOKEN=<32 hex from tables.qrcode> \
#   SMOKE_PRODUCT_ID=<a product uuid> \
#   HEALTH_TOKEN=<the value from Vercel> \
#   SMOKE_ANON_KEY=<NEXT_PUBLIC_SUPABASE_ANON_KEY> SMOKE_SUPABASE_URL=<NEXT_PUBLIC_SUPABASE_URL> \
#   SMOKE_ALLOW_WRITES=1 \
#   bash scripts/smoke-test.sh
#
# Every check prints PASS/FAIL/SKIP and the raw evidence. Exit code is the number of failures.
set -uo pipefail

BASE_URL="${BASE_URL:?set BASE_URL (e.g. https://dokanstore.xyz)}"
MENU_PATH="/${SMOKE_SLUG:?set SMOKE_SLUG}/${SMOKE_TABLE_TOKEN:+}/menu/${SMOKE_TABLE:?set SMOKE_TABLE}"
MENU_PATH="/${SMOKE_SLUG}/menu/${SMOKE_TABLE}"
FAILS=0
pass() { printf 'PASS  %-58s %s\n' "$1" "$2"; }
fail() { printf 'FAIL  %-58s %s\n' "$1" "$2"; FAILS=$((FAILS + 1)); }
skip() { printf 'SKIP  %-58s %s\n' "$1" "$2"; }

echo "smoke: $BASE_URL  menu: $MENU_PATH  writes: ${SMOKE_ALLOW_WRITES:-0}"
echo

# ── 1. the two deleted public routes must be gone ───────────────────────────
for r in bill waiter; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/public/$r")
  [ "$code" = "404" ] && pass "GET /api/public/$r is gone" "404" || fail "GET /api/public/$r is gone" "got $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/public/$r" -H 'content-type: application/json' -d '{}')
  [ "$code" = "404" ] && pass "POST /api/public/$r is gone" "404" || fail "POST /api/public/$r is gone" "got $code"
done

# ── 2. the menu: JSON-LD, no token, no ?k= dependency, headers ──────────────
html_plain=$(curl -s "$BASE_URL$MENU_PATH")
html_token=$(curl -s "$BASE_URL$MENU_PATH?k=0123456789abcdef0123456789abcdef")
if echo "$html_plain" | grep -q 'jsonLd="\[object Object\]"'; then
  fail "no jsonLd=\"[object Object]\" in the menu HTML" "the old attribute is back (audit T1 #5)"
else
  pass "no jsonLd=\"[object Object]\" in the menu HTML" ""
fi
if echo "$html_plain" | grep -q '"@type":"Restaurant"'; then
  pass "a real JSON-LD body is present" "$(echo "$html_plain" | grep -o '"@type":"Restaurant"' | head -1)"
else
  fail "a real JSON-LD body is present" "no Restaurant JSON-LD found"
fi
[ "$html_plain" = "$html_token" ] \
  && pass "menu HTML identical with and without ?k=" "D3: the page is cacheable" \
  || fail "menu HTML identical with and without ?k=" "the render depends on the token"
if [ -n "${SMOKE_TABLE_TOKEN:-}" ]; then
  if echo "$html_token" | grep -q "$SMOKE_TABLE_TOKEN"; then
    fail "the table token never appears in the HTML" "token leaked into the page source"
  else
    pass "the table token never appears in the HTML" ""
  fi
else
  skip "the table token never appears in the HTML" "set SMOKE_TABLE_TOKEN to check the real value"
fi
hdr=$(curl -sI "$BASE_URL$MENU_PATH")
echo "$hdr" | grep -qi 'referrer-policy: *no-referrer' \
  && pass "Referrer-Policy: no-referrer on the menu" "" \
  || fail "Referrer-Policy: no-referrer on the menu" "$(echo "$hdr" | grep -i referrer-policy | tr -d '\r')"
echo "$hdr" | grep -qi 'x-xss-protection' \
  && fail "X-XSS-Protection is absent" "the deprecated header is back (audit T1 #22)" \
  || pass "X-XSS-Protection is absent" ""
for h in content-security-policy strict-transport-security x-content-type-options x-frame-options; do
  echo "$hdr" | grep -qi "^$h" && pass "header present: $h" "" || fail "header present: $h" "missing"
done

# ── 3. anon cannot read the table token through PostgREST ───────────────────
if [ -n "${SMOKE_SUPABASE_URL:-}" ] && [ -n "${SMOKE_ANON_KEY:-}" ]; then
  body=$(curl -s "$SMOKE_SUPABASE_URL/rest/v1/tables?select=qrcode&limit=1" \
    -H "apikey: $SMOKE_ANON_KEY" -H "authorization: Bearer $SMOKE_ANON_KEY")
  if echo "$body" | grep -qi 'permission denied\|42501'; then
    pass "anon cannot read tables.qrcode via PostgREST" "42501 permission denied"
  else
    fail "anon cannot read tables.qrcode via PostgREST" "got: $(echo "$body" | head -c 120)"
  fi
else
  skip "anon cannot read tables.qrcode via PostgREST" "set SMOKE_SUPABASE_URL + SMOKE_ANON_KEY"
fi

# ── 4. /api/health: minimal without a token, detailed with ─────────────────
min=$(curl -s "$BASE_URL/api/health")
echo "$min" | grep -q '"integrations"' \
  && fail "/api/health is minimal without a token" "it disclosed the integrations block" \
  || pass "/api/health is minimal without a token" "$(echo "$min" | head -c 60)…"
if [ -n "${HEALTH_TOKEN:-}" ]; then
  det=$(curl -s -H "authorization: Bearer $HEALTH_TOKEN" "$BASE_URL/api/health")
  echo "$det" | grep -q '"integrations"' \
    && pass "/api/health is detailed with HEALTH_TOKEN" "" \
    || fail "/api/health is detailed with HEALTH_TOKEN" "no integrations block: $(echo "$det" | head -c 80)"
else
  skip "/api/health is detailed with HEALTH_TOKEN" "set HEALTH_TOKEN"
fi

# ── 5. the order path: wrong token 404, valid token accepted ───────────────
POST="$BASE_URL/api/public/order"
junk=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$POST" -H 'content-type: application/json' \
  -d "{\"projectSlug\":\"$SMOKE_SLUG\",\"tableSlug\":\"$SMOKE_TABLE\",\"tableToken\":\"junk\",\"items\":[{\"productId\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]}")
[ "$junk" = "404" ] && pass "a malformed token is 404" "404" || fail "a malformed token is 404" "got $junk"

unknown=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$POST" -H 'content-type: application/json' \
  -d "{\"projectSlug\":\"$SMOKE_SLUG\",\"tableSlug\":\"$SMOKE_TABLE\",\"tableToken\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"items\":[{\"productId\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]}")
[ "$unknown" = "404" ] && pass "a well-formed but wrong token is 404" "404" || fail "a well-formed but wrong token is 404" "got $unknown"

if [ "${SMOKE_ALLOW_WRITES:-0}" = "1" ] && [ -n "${SMOKE_TABLE_TOKEN:-}" ] && [ -n "${SMOKE_PRODUCT_ID:-}" ]; then
  echo "      (creating one real order in $SMOKE_SLUG — delete it afterwards)"
  rm -f /tmp/smoke-order.json
  code=$(curl -s -o /tmp/smoke-order.json -w '%{http_code}' -X POST "$POST" -H 'content-type: application/json' \
    -d "{\"projectSlug\":\"$SMOKE_SLUG\",\"tableSlug\":\"$SMOKE_TABLE\",\"tableToken\":\"$SMOKE_TABLE_TOKEN\",\"clientRequestId\":\"$(uuidgen 2>/dev/null || echo 11111111-2222-3333-4444-555555555555)\",\"items\":[{\"productId\":\"$SMOKE_PRODUCT_ID\",\"quantity\":1}]}")
  if [ "$code" = "201" ] || [ "$code" = "200" ]; then
    pass "a valid token is accepted" "$code $(head -c 100 /tmp/smoke-order.json)"
  else
    fail "a valid token is accepted" "got $code $(head -c 160 /tmp/smoke-order.json)"
  fi
else
  skip "a valid token is accepted (creates a real order)" "set SMOKE_ALLOW_WRITES=1 SMOKE_TABLE_TOKEN SMOKE_PRODUCT_ID"
fi

# a tokenless order is accepted only while REQUIRE_TABLE_TOKEN=false
if [ "${SMOKE_ALLOW_WRITES:-0}" = "1" ]; then
  echo "      (tokenless probe — expect 201 while the flag is false, 403 once it is true)"
  code=$(curl -s -o /tmp/smoke-order-tokenless.json -w '%{http_code}' -X POST "$POST" -H 'content-type: application/json' \
    -d "{\"projectSlug\":\"$SMOKE_SLUG\",\"tableSlug\":\"$SMOKE_TABLE\",\"items\":[{\"productId\":\"${SMOKE_PRODUCT_ID:-00000000-0000-0000-0000-000000000000}\",\"quantity\":1}]}")
  case "$code" in
    201|200) pass "tokenless order behaviour" "$code (flag is false — the rollout window)" ;;
    403)     pass "tokenless order behaviour" "403 (flag is true — enforcement is on)" ;;
    *)       fail "tokenless order behaviour" "got $code, expected 200/201/403" ;;
  esac
else
  skip "tokenless order behaviour" "set SMOKE_ALLOW_WRITES=1 (it creates an order)"
fi

echo
echo "failures: $FAILS"
exit "$FAILS"

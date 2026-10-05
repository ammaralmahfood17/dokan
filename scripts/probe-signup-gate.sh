#!/usr/bin/env bash
# Live verification of the signup CAPTCHA gate — one dev server at a time (Next refuses two
# dev servers from the same directory: a lock file makes the second exit with code 0).
set -u
cd /home/ammar/dokan-v3

kill_port() {
  local pids
  pids=$(ss -ltnp 2>/dev/null | grep ":$1" | grep -oP 'pid=\K[0-9]+' | sort -u)
  for p in $pids; do kill "$p" 2>/dev/null; done
  sleep 1
}

wait_ready() {
  for _ in $(seq 1 45); do
    curl -s -o /dev/null "http://localhost:3102/login" && return 0
    sleep 1
  done
  echo "!! server never became ready"; tail -5 "$1"; return 1
}

BODY='{"email":"probe-audit@example.com","password":"ProbePass123","fullName":"فحص"}'
BODY_TOKEN='{"email":"probe-audit@example.com","password":"ProbePass123","fullName":"فحص","turnstileToken":"bogus-token-value"}'

echo "################ CASE A: secret set, production NOT declared ################"
kill_port 3102
TURNSTILE_SECRET=0x4AAAAAAAfake-secret-for-probe nohup npm run dev -- --port 3102 > /tmp/caseA.log 2>&1 &
wait_ready /tmp/caseA.log || exit 1

echo -n "no token      -> "
curl -s -w ' [%{http_code}]\n' -X POST http://localhost:3102/api/auth/signup \
  -H 'content-type: application/json' -d "$BODY"

echo -n "bogus token   -> "
curl -s -w ' [%{http_code}]\n' -X POST http://localhost:3102/api/auth/signup \
  -H 'content-type: application/json' -d "$BODY_TOKEN"
kill_port 3102

echo
echo "################ CASE B: VERCEL_ENV=production, NO secret (must be 503) ################"
VERCEL_ENV=production nohup npm run dev -- --port 3102 > /tmp/caseB.log 2>&1 &
wait_ready /tmp/caseB.log || exit 1

echo -n "any request   -> "
curl -s -w ' [%{http_code}]\n' -X POST http://localhost:3102/api/auth/signup \
  -H 'content-type: application/json' -d "$BODY"
kill_port 3102

echo
echo "################ residue check: nothing was created ################"
DBURL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")"
psql "$DBURL" -At -c "select 'probe_users=' || count(*) from auth.users where email like 'probe-audit%';"
echo "ports: $(ss -ltn | grep -cE ':3102') still listening"

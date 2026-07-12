#!/bin/bash
# TradeBobby Watchdog — monitors dashboard + daemons, restarts dead ones.
# Usage:
#   bash watchdog.sh           # one-shot check
#   bash watchdog.sh --loop    # continuous monitoring (every 60s)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Cron strips the user PATH, so resolve node explicitly (nvm install first, then system).
if ! command -v node >/dev/null 2>&1; then
  for cand in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$cand/node" ] && PATH="$cand:$PATH" && break
  done
fi
export PATH

# Load local secrets so restarted daemons inherit API keys (same as manage.sh).
if [ -f "$SCRIPT_DIR/.env" ]; then set -a; . "$SCRIPT_DIR/.env"; set +a; fi

# Keep in sync with DAEMONS in manage.sh.
DAEMONS=(
  "macro-pulse.js --daemon"
  "macro-context.js --daemon"
  "crypto-pulse.js --daemon"
  "derivatives.js --daemon"
  "orderflow-crypto.js --daemon"
  "news-scanner.js --daemon"
  "cot-fetcher.js --daemon"
  "onchain-btc.js --daemon"
  "earnings-cal.js --daemon"
  "setup-tracker.js --daemon"
  "currency-strength.js --daemon"
  "reddit-mania.js --daemon"
  "setup-alerter.js --daemon"
  "trade-agent.js --daemon"
  "etf-flows.js --daemon"
  "claude-narrator.js --daemon"
  "tts-narrator.js --daemon"
  "weekly-brief.js --daemon"
  "auto-scan.js --daemon"
  "econ-calendar.js --daemon"
)

# Output-freshness map: "<output.json>:<max_age_seconds>" per daemon script name.
# Only the fast/periodic daemons are listed. Slow/long-interval ones (cot-fetcher daily,
# econ-calendar daily, auto-scan 4h, weekly-brief weekly, setup-alerter/tracker event-driven,
# claude/tts narrators) are intentionally omitted -- for them, being "stale" is normal, so
# they stay on liveness-only checking and are never restarted for lack of fresh output.
# Thresholds are ~3-4x the daemon's own interval to avoid thrashing on a slow cycle.
fresh_spec() {
  case "$1" in
    macro-pulse.js)       echo "macro_pulse.json:1800" ;;      # writes every 5m
    crypto-pulse.js)      echo "crypto_pulse.json:1800" ;;
    derivatives.js)       echo "derivatives.json:600" ;;      # writes every 60s
    orderflow-crypto.js)  echo "orderflow_crypto.json:1800" ;;
    currency-strength.js) echo "currency_strength.json:1800" ;;
    onchain-btc.js)       echo "onchain_btc.json:3600" ;;
    macro-context.js)     echo "macro_context.json:5400" ;;    # every 30m
    news-scanner.js)      echo "news_feed.json:3600" ;;
    reddit-mania.js)      echo "reddit_mania.json:3600" ;;
    etf-flows.js)         echo "etf_flows.json:7200" ;;
    earnings-cal.js)      echo "earnings_cal.json:43200" ;;    # every ~6-12h
    *)                    echo "" ;;
  esac
}

check_and_restart() {
  local now
  now=$(date '+%Y-%m-%dT%H:%M:%S')
  local started=0

  # Check dashboard HTTP (most reliable signal)
  if ! curl -sf http://localhost:3333/ -o /dev/null -m 3 2>/dev/null; then
    echo "[$now] ❌ dashboard HTTP down — restarting server.js"
    pkill -f "node server.js" 2>/dev/null
    sleep 1
    nohup node server.js > /tmp/tb-dashboard.log 2>&1 &
    disown
    started=$((started + 1))
  fi

  # Check each daemon by full command match
  for d in "${DAEMONS[@]}"; do
    local script="${d%% *}"
    local log="${script%.js}.log"
    # pgrep -f self-excludes; the old ps|grep matched its own grep line so a dead daemon was NEVER detected
    if ! pgrep -f "node $d" >/dev/null 2>&1; then
      echo "[$now] ❌ $script DEAD — restarting"
      nohup node $d >> "$log" 2>&1 &
      disown
      started=$((started + 1))
      continue
    fi
    # Alive but check OUTPUT FRESHNESS. A daemon can be a live PID yet stop writing
    # (hung socket after machine sleep -- on 2026-07-11 every output froze for 22h while
    # the processes stayed "green"). Liveness alone missed it; freshness catches it.
    local spec; spec="$(fresh_spec "$script")"
    if [ -n "$spec" ]; then
      local file="${spec%%:*}"; local maxage="${spec##*:}"
      if [ -f "$file" ]; then
        local age=$(( $(date +%s) - $(stat -f %m "$file" 2>/dev/null || echo 0) ))
        if [ "$age" -gt "$maxage" ]; then
          echo "[$now] ⏳ $script HUNG (output ${age}s > ${maxage}s stale) — restarting"
          pkill -f "node $d" 2>/dev/null; sleep 1
          nohup node $d >> "$log" 2>&1 &
          disown
          started=$((started + 1))
        fi
      fi
    fi
  done

  if [ "$started" -eq 0 ]; then
    echo "[$now] ✅ all healthy (dashboard + ${#DAEMONS[@]} daemons)"
  else
    echo "[$now] 🔄 restarted $started process(es)"
  fi
}

if [ "$1" = "--loop" ]; then
  echo "🐕 Watchdog running (60s loop, Ctrl-C to stop)..."
  while true; do
    check_and_restart
    sleep 60
  done
else
  check_and_restart
  echo ""
  echo "Live processes:"
  ps -ax -o pid,command | grep -E "node (server\\.js|[a-z-]+\\.js --daemon)" | grep -v grep
fi

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
    # pgrep -f self-excludes; the old ps|grep matched its own grep line so a dead daemon was NEVER detected
    if ! pgrep -f "node $d" >/dev/null 2>&1; then
      echo "[$now] ❌ $script DEAD — restarting"
      local log="${script%.js}.log"
      nohup node $d >> "$log" 2>&1 &
      disown
      started=$((started + 1))
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

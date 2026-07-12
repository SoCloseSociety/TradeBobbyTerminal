#!/bin/bash
# TradeBobby Manager — unified control script for dashboard + daemons.
# Usage:
#   bash manage.sh start [name]    # start everything or single daemon
#   bash manage.sh stop [name]     # stop everything or single daemon
#   bash manage.sh restart [name]  # restart
#   bash manage.sh status          # show process state
#   bash manage.sh logs [name]     # tail logs (live)
#   bash manage.sh health          # call /api/health
#   bash manage.sh test            # run smoke test
#   bash manage.sh watchdog        # one-shot watchdog check

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Resolve node's PATH. When launched from the Finder/Electron app (or cron), the process
# inherits a minimal PATH WITHOUT node, so every `node …` below would fail silently and no
# daemon would start. Prepend the nvm/homebrew locations if node isn't already found.
if ! command -v node >/dev/null 2>&1; then
  for cand in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$cand/node" ] && PATH="$cand:$PATH" && break
  done
fi
export PATH

# Load local secrets (gitignored .env) so daemons inherit API keys
# (ANTHROPIC_API_KEY for claude-narrator, TELEGRAM_*/DISCORD_* for alerts, etc.).
if [ -f "$SCRIPT_DIR/.env" ]; then set -a; . "$SCRIPT_DIR/.env"; set +a; fi

DAEMONS=(
  "macro-pulse"
  "macro-context"
  "crypto-pulse"
  "derivatives"
  "orderflow-crypto"
  "news-scanner"
  "cot-fetcher"
  "onchain-btc"
  "earnings-cal"
  "setup-tracker"
  "currency-strength"
  "reddit-mania"
  "setup-alerter"
  "trade-agent"
  "etf-flows"
  "claude-narrator"
  "tts-narrator"
  "weekly-brief"
  "auto-scan"
  "econ-calendar"
)

CMD="${1:-status}"
TARGET="${2:-}"

start_daemon() {
  local d="$1"
  if pgrep -f "node $d.js --daemon" >/dev/null 2>&1; then
    echo "  ⏭  $d already running"
  else
    nohup node "$d.js" --daemon > "$d.log" 2>&1 &
    disown
    echo "  ✅ $d started"
  fi
}

stop_daemon() {
  local d="$1"
  if pkill -f "node $d.js --daemon" 2>/dev/null; then
    echo "  🛑 $d stopped"
  else
    echo "  ⏭  $d not running"
  fi
}

start_dashboard() {
  if curl -sf http://localhost:3333/ -o /dev/null -m 3 2>/dev/null; then
    echo "  ⏭  dashboard already serving"
  else
    pkill -f "node server.js" 2>/dev/null
    sleep 1
    nohup node server.js > /tmp/tb-dashboard.log 2>&1 &
    disown
    echo "  ✅ dashboard started on :3333"
  fi
}

stop_dashboard() {
  if pkill -f "node server.js" 2>/dev/null; then
    echo "  🛑 dashboard stopped"
  else
    echo "  ⏭  dashboard not running"
  fi
}

case "$CMD" in
  start)
    if [ -n "$TARGET" ]; then
      if [ "$TARGET" = "dashboard" ]; then start_dashboard
      else start_daemon "$TARGET"; fi
    else
      echo "🚀 Starting TradeBobby..."
      start_dashboard
      for d in "${DAEMONS[@]}"; do start_daemon "$d"; done
      echo "✅ All started → http://localhost:3333"
    fi
    ;;

  stop)
    if [ -n "$TARGET" ]; then
      if [ "$TARGET" = "dashboard" ]; then stop_dashboard
      else stop_daemon "$TARGET"; fi
    else
      echo "🛑 Stopping TradeBobby..."
      for d in "${DAEMONS[@]}"; do stop_daemon "$d"; done
      stop_dashboard
      echo "✅ All stopped"
    fi
    ;;

  restart)
    if [ -n "$TARGET" ]; then
      if [ "$TARGET" = "dashboard" ]; then stop_dashboard; sleep 1; start_dashboard
      else stop_daemon "$TARGET"; sleep 1; start_daemon "$TARGET"; fi
    else
      # Re-invoke via bash+absolute path: bare "$0" ("manage.sh") isn't on PATH so it
      # failed with "command not found" when called as `bash manage.sh restart`.
      bash "$SCRIPT_DIR/manage.sh" stop
      sleep 2
      bash "$SCRIPT_DIR/manage.sh" start
    fi
    ;;

  status)
    echo "═══ TradeBobby Status ═══"
    if curl -sf http://localhost:3333/ -o /dev/null -m 3 2>/dev/null; then
      echo "🟢 dashboard       http://localhost:3333"
    else
      echo "🔴 dashboard       DOWN"
    fi
    for d in "${DAEMONS[@]}"; do
      if pgrep -f "node $d.js --daemon" >/dev/null 2>&1; then
        echo "🟢 $d daemon"
      else
        echo "🔴 $d daemon DOWN"
      fi
    done
    echo ""
    echo "Health: $(curl -sf http://localhost:3333/api/health -m 3 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'ok={d[\"ok\"]} uptime={d[\"uptime_sec\"]}s sources_ok={d[\"summary\"][\"ok\"]}/{d[\"summary\"][\"ok\"]+d[\"summary\"][\"stale\"]+d[\"summary\"][\"missing\"]}')" 2>/dev/null || echo 'unreachable')"
    ;;

  logs)
    if [ -z "$TARGET" ]; then
      echo "Usage: $0 logs <daemon-name>"
      echo "Available: ${DAEMONS[*]}"
      exit 1
    fi
    if [ -f "$TARGET.log" ]; then
      tail -50 "$TARGET.log"
    else
      echo "❌ No log file at $TARGET.log"
      exit 1
    fi
    ;;

  health)
    curl -s http://localhost:3333/api/health -m 5 | python3 -m json.tool 2>/dev/null || echo "❌ dashboard unreachable"
    ;;

  test)
    bash "$SCRIPT_DIR/smoke-test.sh"
    ;;

  watchdog)
    bash "$SCRIPT_DIR/watchdog.sh"
    ;;

  *)
    echo "TradeBobby Manager"
    echo ""
    echo "Usage:"
    echo "  bash manage.sh start [daemon]    Start everything or single daemon"
    echo "  bash manage.sh stop [daemon]     Stop everything or single daemon"
    echo "  bash manage.sh restart [daemon]  Restart"
    echo "  bash manage.sh status            Process + health overview"
    echo "  bash manage.sh logs <daemon>     Tail last 50 log lines"
    echo "  bash manage.sh health            Pretty-print /api/health"
    echo "  bash manage.sh test              Run smoke test"
    echo "  bash manage.sh watchdog          One-shot watchdog check"
    echo ""
    echo "Daemons available: ${DAEMONS[*]} (or 'dashboard')"
    ;;
esac

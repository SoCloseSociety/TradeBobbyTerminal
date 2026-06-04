#!/bin/bash
# TradeBobby Agent — Start everything
# Usage: bash start-agent.sh
# Optional env vars:
#   TV_MCP_DIR — path to your tradingview-mcp-jackson install (default ~/tradingview-mcp-jackson)
#   NODE_BIN   — path to node binary (default 'node' from PATH)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TV_MCP_DIR="${TV_MCP_DIR:-$HOME/tradingview-mcp-jackson}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

echo "🤖 TradeBobby Agent Starting..."

# 1. Make sure TradingView is running (optional — only if MCP is installed)
if [ -f "$TV_MCP_DIR/scripts/start-trading.sh" ]; then
    bash "$TV_MCP_DIR/scripts/start-trading.sh"
else
    echo "⚠️  TradingView MCP not found at $TV_MCP_DIR (skipping scanner — install MCP Jackson or set TV_MCP_DIR)"
fi

# 2. Start dashboard web server (background)
cd "$SCRIPT_DIR"
if lsof -i :3333 >/dev/null 2>&1; then
    echo "✅ Dashboard already running at http://localhost:3333"
else
    node server.js &
    echo "✅ Dashboard started at http://localhost:3333"
fi

# 3. Run initial scan
echo "🔄 Running initial scan..."
node auto-scan.js

# 3b. Start macro-pulse and crypto-pulse daemons (every 5min)
if ! pgrep -f "macro-pulse.js --daemon" > /dev/null; then
    nohup node macro-pulse.js --daemon > macro-pulse.log 2>&1 &
    echo "✅ macro-pulse daemon started (DXY/VIX/yields, every 5min)"
else
    echo "✅ macro-pulse daemon already running"
fi
if ! pgrep -f "crypto-pulse.js --daemon" > /dev/null; then
    nohup node crypto-pulse.js --daemon > crypto-pulse.log 2>&1 &
    echo "✅ crypto-pulse daemon started (F&G/dom/funding, every 5min)"
else
    echo "✅ crypto-pulse daemon already running"
fi
if ! pgrep -f "cot-fetcher.js --daemon" > /dev/null; then
    nohup node cot-fetcher.js --daemon > cot.log 2>&1 &
    echo "✅ cot-fetcher daemon started (CFTC institutional positioning, every 6h)"
else
    echo "✅ cot-fetcher daemon already running"
fi
if ! pgrep -f "onchain-btc.js --daemon" > /dev/null; then
    nohup node onchain-btc.js --daemon > onchain-btc.log 2>&1 &
    echo "✅ onchain-btc daemon started (hashrate/fees/halving, every 10min)"
else
    echo "✅ onchain-btc daemon already running"
fi
if ! pgrep -f "earnings-cal.js --daemon" > /dev/null; then
    nohup node earnings-cal.js --daemon > earnings-cal.log 2>&1 &
    echo "✅ earnings-cal daemon started (Mag-7 + key tickers, every 12h)"
else
    echo "✅ earnings-cal daemon already running"
fi
if ! pgrep -f "setup-tracker.js --daemon" > /dev/null; then
    nohup node setup-tracker.js --daemon > setup-tracker.log 2>&1 &
    echo "✅ setup-tracker daemon started (signal performance, every 15min)"
else
    echo "✅ setup-tracker daemon already running"
fi
if ! pgrep -f "currency-strength.js --daemon" > /dev/null; then
    nohup node currency-strength.js --daemon > currency-strength.log 2>&1 &
    echo "✅ currency-strength daemon started (FX relative strength, every 5min)"
else
    echo "✅ currency-strength daemon already running"
fi
if ! pgrep -f "reddit-mania.js --daemon" > /dev/null; then
    nohup node reddit-mania.js --daemon > reddit-mania.log 2>&1 &
    echo "✅ reddit-mania daemon started (retail sentiment, every 30min)"
else
    echo "✅ reddit-mania daemon already running"
fi
if ! pgrep -f "setup-alerter.js --daemon" > /dev/null; then
    nohup node setup-alerter.js --daemon > setup-alerter.log 2>&1 &
    echo "✅ setup-alerter daemon started (A+ signals macOS notify, every 1min)"
else
    echo "✅ setup-alerter daemon already running"
fi
if ! pgrep -f "trade-agent.js --daemon" > /dev/null; then
    nohup node trade-agent.js --daemon > trade-agent.log 2>&1 &
    echo "✅ trade-agent daemon started (multi-source synthesis brief, every 15min)"
else
    echo "✅ trade-agent daemon already running"
fi

# 4. Set up cron for auto-scan every 4 hours
CRON_CMD="cd $SCRIPT_DIR && $NODE_BIN auto-scan.js >> $SCRIPT_DIR/auto-scan.log 2>&1"
CRON_EXISTS=$(crontab -l 2>/dev/null | grep -c "auto-scan.js")

if [ "$CRON_EXISTS" -eq 0 ]; then
    (crontab -l 2>/dev/null; echo "0 */4 * * * $CRON_CMD") | crontab -
    echo "✅ Cron set: auto-scan every 4 hours"
else
    echo "✅ Cron already configured"
fi

echo ""
echo "═══════════════════════════════════════"
echo "🤖 TradeBobby Agent ACTIVE"
echo "═══════════════════════════════════════"
echo ""
echo "📊 Dashboard:  http://localhost:3333"
echo "🔄 Auto-scan:  every 4 hours (cron)"
echo "📁 Logs:       $SCRIPT_DIR/*.log (auto-rotated at 1MB)"
echo "🧠 Brief:      $SCRIPT_DIR/daily_brief.md"
echo ""
echo "Commands:"
echo "  node auto-scan.js     — manual scan now"
echo "  node server.js        — restart dashboard"
echo "  tail -f auto-scan.log — watch live logs"
echo ""

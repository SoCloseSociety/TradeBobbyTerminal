# TradeBobby — Project Context for Claude (template)

> Copy this file to `CLAUDE.md` and customize for your local setup.

## Project Overview
TradeBobby is the central workspace for AI-assisted trading using TradingView MCP Jackson.

## Key Paths
- **MCP Server:** `~/tradingview-mcp-jackson/` (set via `TV_MCP_DIR` env var if elsewhere)
- **MCP Config:** `~/.claude/.mcp.json`
- **Trading Rules:** `~/tradingview-mcp-jackson/rules.json`
- **Launch Script:** `~/tradingview-mcp-jackson/scripts/start-trading.sh`

## How to Start a Trading Session
1. Run `start-trading` in terminal (or `bash ~/tradingview-mcp-jackson/scripts/start-trading.sh`)
2. Log into TradingView in the Chrome window that opens
3. Open a chart on tradingview.com/chart/
4. In Claude Code, run `tv_health_check` to verify connection

## Important Notes
- TradingView Desktop v2.14.0 does NOT support --remote-debugging-port
- Chrome with CDP port 9222 instead (--user-data-dir=$HOME/.chrome-debug-profile)
- The Chrome debug profile is separate — log into TradingView once in this profile

## Trading Style (customize)
- Methodology: ICT/SMC (BOS, CHoCH, FVG, Order Blocks)
- Timezone: <your timezone, e.g. UTC+7>
- Best session: London/NY overlap <your local time>
- Risk: 1% per trade, 1:2 min R:R, max 3 positions

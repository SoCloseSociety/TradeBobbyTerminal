# Daily Watchlist -- Evidence-Based (rewritten 2026-06-21)

Daily scan list aligned with `rules.json`, `PLAYBOOK.md` and `RESEARCH_FINDINGS.md` (control room: `~/Documents/VsCodeN30/tradingviewcheck/`).

No em dashes in this repo by convention. Use "--".

## Mindset first

The evidence is blunt: >80% of active retail traders lose, <1% are persistently profitable, and ICT/SMC is unproven. This file is not a signal generator. It exists to keep the daily process tight: few instruments, few timeframes, strict risk. The only proven edge is low leverage, low cost, low frequency, strict risk control. ICT (FVG, order blocks, BOS/CHoCH, killzones) is used ONLY to mark structure and levels, never as a reason to trade by itself.

## Markets

Core = forex + gold, stock indices, US large-cap stocks. Crypto = WATCH ONLY (observation, not traded until refreshed). Oil dropped.

## Live cockpits (TradingView layouts, built 2026-06-21)

Switch between them from the TradingView layout menu:
- **MAIN** -- cross-asset 4H: XAUUSD, NAS100, EURUSD, NVDA
- **INDICES** -- 4H: NAS100, SPX500, US30, DAX
- **US STOCKS** -- Daily: NVDA, AAPL, TSLA, QQQ
- **CRYPTO WATCH** -- 4H (observation only): BTC, ETH, SOL, TOTAL

Each chart: EMA 50 + EMA 200 (trend context) + Volume. Add ATR(14) and session VWAP on the drill-in chart for sizing and intraday mean.

## Tier-1 watchlist (the 12 the morning brief scans)

XAUUSD, EURUSD, GBPUSD, USDJPY, NAS100, SPX500, US30, DAX, NVDA, AAPL, TSLA, QQQ.

Full per-class lists (feeds standardized: OANDA for FX/metals/index CFDs, NASDAQ for US stocks, TVC for macro) live in `rules.json` under `watchlist`. Macro glance: DXY, VIX, US10Y.

## Daily routine (UTC+7, Koh Samui)

You do not need to watch every session. Pick the window for what you trade today.
1. Pre-London (12:00-14:00): glance MACRO (DXY/VIX/US10Y), mark Daily/4H bias + key levels on tier-1, check the economic calendar for high-impact news.
2. London (14:00-18:00): FX majors + DAX liquid. First move is often a fake-out; wait.
3. London/NY overlap (20:30-23:00) -- PRIME: highest liquidity for FX + US indices.
4. US cash open (20:30-22:00): best window for US stocks (first 90 minutes).
5. Outside these windows: spreads widen, slippage eats you. Default to no trade.

Run the brief: `node ~/tradingview-mcp-jackson/src/cli/index.js brief` (or `/morning-brief`).

## Pre-trade checklist (canonical -- see PLAYBOOK.md section 4)

Take a trade ONLY if all are true:
1. Daily AND 4H bias agree.
2. Price is AT a pre-marked level (swing, session high/low, VWAP, clean S/R or order block).
3. 15m confirmation (structure shift / confirmation candle). Do not anticipate.
4. ATR-based stop fits inside 1% risk (if too wide, skip -- do not tighten).
5. Reward-to-risk >= 1:2.
6. Session liquid for the instrument, no high-impact news within 30 min.

## Risk (non-negotiable, see rules.json)

1% risk/trade from an ATR stop; max 3 open + 3 new/day; daily stop after -2% or 2 losses; leverage far below caps (FX <=5:1, gold/indices <=3:1, US stocks <=2:1); never widen a stop; never move SL to BE before +1R; journal every trade and review weekly.

## Notes

- The legacy `Pro_Trading_System_V5.pine` is NOT the basis of this process. It currently does not compile and its dashboard win-rate is a biased simulation (see `~/Documents/VsCodeN30/tradingviewcheck/tasks/lessons.md`). Do not rely on its numbers.
- This file defers to `rules.json` and `PLAYBOOK.md` as the source of truth. If they disagree with this file, they win.

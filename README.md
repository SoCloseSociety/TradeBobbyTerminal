# TradeBobby — AI Trading Terminal

Bloomberg-style market intelligence terminal for ICT/SMC macro trading.

## 🎯 Quick start

```bash
cd dashboard
bash start-agent.sh         # launches dashboard + 10 daemons
open http://localhost:3333   # opens the terminal in your browser
```

## 📂 Structure

```
TradeBobby/
├── CLAUDE.md                       # project context for Claude
├── DAILY_WATCHLIST.md              # ~100 charts categorized by tier
├── PINE_V6_CHANGELOG.md            # Pine Script V6 release notes
├── AGENT_ARCHITECTURE.md           # autonomous trading agent design
├── MARGIN_STRATEGY.md              # position sizing playbook
├── Pro_Trading_System_V5.pine      # Pine V6 indicator (1931 lines, 40 alerts)
│
├── dashboard/                      # web terminal + data fetchers
│   ├── server.js                   # Express server + HTML (3343 lines, 24 endpoints)
│   ├── start-agent.sh              # one-shot startup script
│   │
│   ├── _log-helper.js              # shared bounded logger (1MB cap)
│   │
│   ├── auto-scan.js                # TradingView MCP scanner (V5 ICT/SMC)
│   ├── generate-setups.js          # V5 setup engine
│   ├── news-scanner.js             # RSS news + triggers + sentiment
│   ├── econ-calendar.js            # macro events calendar
│   │
│   ├── macro-pulse.js              # DXY/VIX/yields/sectors/Mag-7 via Yahoo
│   ├── crypto-pulse.js             # F&G / dominance / funding rates
│   ├── cot-fetcher.js              # CFTC institutional positioning
│   ├── onchain-btc.js              # BTC network metrics
│   ├── earnings-cal.js             # Mag-7 + key tickers earnings
│   ├── reddit-mania.js             # retail sentiment scraper
│   ├── currency-strength.js        # FX relative strength meter
│   ├── setup-tracker.js            # V5 signal performance logger
│   ├── setup-alerter.js            # A+ signal macOS notifier
│   └── trade-agent.js              # multi-source synthesis brief
│
├── sessions/                       # markdown session journals
└── legacy/                         # archived paper-trading + broker integration
    ├── paper_portfolio.json
    ├── backtest.js
    ├── broker-icmarkets.js         # MetaApi cloud (optional MT4/5)
    └── broker-ctrader.js           # cTrader Open API (optional)
```

## 🛰️ Daemons (auto-refresh in background)

| Daemon | Interval | Source |
|---|---|---|
| auto-scan | manual / cron 4h | TradingView MCP Jackson |
| news-scanner | manual / cron | Google News RSS |
| econ-calendar | manual / cron | recurring + manual events |
| macro-pulse | 5 min | Yahoo Finance (52 tickers) |
| crypto-pulse | 5 min | alternative.me + CoinGecko + Binance |
| cot-fetcher | 6 hours | CFTC publicreporting.cftc.gov |
| onchain-btc | 10 min | blockchain.info + mempool.space |
| earnings-cal | 12 hours | NASDAQ |
| reddit-mania | 30 min | r/wallstreetbets + r/stocks + r/CryptoCurrency |
| currency-strength | 5 min | derived from scan + macro-pulse |
| setup-tracker | 15 min | local scan_history.json |
| setup-alerter | 1 min | live_setups.json watcher |
| trade-agent | 15 min | synthesis across all sources |

## 🖥️ Terminal panels (41 modules)

**Sticky bars (top→bottom):**
- Status bar (13 cells: REGIME / VIX / DXY / GOLD / WTI / F&G / 10Y / NEWS / TRIG / SESS / UTC+7 / SCAN / MCP)
- Live ticker (auto-scroll prices)
- Catalyst Countdown (next HIGH-impact event T-XX)
- Setup A+ Alert banner (animated when A+ fires)
- Critical News bar (EXTREME triggers)
- MCP banner (warning when scanner stale)
- Data Freshness bar (per-source age pills)
- Live News Headlines crawl (fixed bottom)

**Main panels:**
- Agent Brief (multi-source synthesis)
- Market Wrap (narrative auto-generated)
- Composite Risk Index 0-100
- Market State / Top Signal / Watchlist (★) / Killzones
- Heatmap (filterable by asset class)
- WEI World Indices / Macro Bias / Cross-Asset
- Top Movers / Vol/Squeeze / Broker Live
- Macro Pulse / Crypto Pulse / Yield Curve
- Sector Rotation / COT Positioning / On-chain BTC
- Mag-7 / Earnings Cal / Setup Performance Tracker
- Currency Strength / VIX Term / Reddit Mania
- Alerts Center / Sentiment Trend (24h chart)
- Live News Stream (40 most recent)
- ICT Killzones / Economic Calendar / Key Levels / Position Size Calc

**Interactive:**
- ⌘K Command palette (Bloomberg-style GO syntax: `XAU DES`, `BTC GIP`, `EUR CN`, `OIL STAR`)
- Symbol Detail Modal (embedded TradingView widget + scan + COT + news + per-symbol notes)
- Daily Brief MD viewer with copy/download
- Audio alert toggle (persists in localStorage)

## 📈 Pine Script V6 (Pro_Trading_System_V5.pine)

**1931 lignes · 40 alertes · 132 inputs · 25 groupes · 27 engines · 13 V6 modules**

V6 additions (on top of V5 ICT/SMC base):
1. 🟥 VIX Risk-Off Filter
2. 📊 Anchored VWAP (Daily + Weekly + bands)
3. ⚡ Killzone background highlights
4. 🔄 Breaker Blocks
5. 🧭 Multi-TF Bias (D + 4H + 1H + Cur)
6. ↔️ Inverse FVG (IFVG)
7. 🎯 OTE zone from latest swing
8. 🚫 News Blackout filter
9. 🔱 Power of 3 (AMD phases)
10. 📈 HTF FVG (4H + Daily projected)
11. 💨 Liquidity Voids
12. 🔄 Mitigation Blocks
13. ⭐ Stacked Confluence Zones (multi-structure overlap detector)

See `PINE_V6_CHANGELOG.md` for full details.

## 🎯 Trading workflow

See `DAILY_WATCHLIST.md` for the complete daily routine (~100 charts in 7 tiers).

**Setup A+ checklist (V6):**
- [ ] V5 Confluence ≥ 6/10 (dashboard row 14)
- [ ] MTF Aligned 4/4 (dashboard row 20)
- [ ] Stacked Confluence ≥ 3 (yellow background)
- [ ] Daily VWAP aligned with direction
- [ ] HTF FVG (4H or Daily) aligned
- [ ] Killzone NY overlap active (green background)
- [ ] VIX not stressed (no red background)
- [ ] P3 phase = DISTRIBUTION (NY)
- [ ] Not in News Blackout
- [ ] OTE zone overlap
- [ ] Entry trigger: OB / FVG / Breaker / IFVG / Mitigation / Void

## ⚙️ Configuration

- **Risk per trade:** 1% (configured in V6 inputs + dashboard Position Calc)
- **Min R:R:** 1:2 (V6 input)
- **Max positions:** 3 (paper portfolio constant — no longer enforced)
- **Trading session:** UTC+7 Koh Samui, best LN/NY overlap 20:30-23:00

## 🔧 Maintenance

- Logs auto-rotate at 1MB (keeps last 1000 lines via `_log-helper.js`)
- All transient JSON files are git-ignored (regenerate from fetchers)
- Backups in `legacy/` (paper trading + broker integration archived)

## 📜 License

Private. © 2026 TradeBobby.

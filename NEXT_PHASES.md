# TradeBobby — Next Phases Roadmap

Status: **Phase 0-3 shipped** ✅ — system is healthy, tested, monitored.

## ✅ Shipped phases

### Phase 0 — Foundation (V1)
- Dashboard (3343 lines · 41 panels · 24 endpoints)
- 10 background daemons (auto-refresh)
- Pine Script V6 (1931 lines · 13 V6 modules · 40 alerts)
- Bounded logger (`_log-helper.js`, auto-rotation at 1MB)
- Full PII/secret sanitization
- Git repo initialized + clean commits

### Phase 1 — Health & Observability
- ✅ `/api/health` endpoint (per-source freshness + global OK/degraded)
- ✅ Process uptime tracking

### Phase 2 — Resilience
- ✅ `watchdog.sh` — monitors dashboard + 10 daemons, auto-restarts dead ones
- ✅ `watchdog.sh --loop` for continuous monitoring (60s cycle)
- ✅ HTTP-based liveness probe (not just process existence)

### Phase 3 — Quality assurance
- ✅ `smoke-test.sh` — 73 checks across 8 categories (syntax, HTTP, endpoints, daemons, data, freshness, Pine, logs)
- ✅ Pass/Warn/Fail exit codes for CI integration

### Phase 4 — Alert distribution
- ✅ macOS native notifications (osascript)
- ✅ Discord webhook (opt-in via `DISCORD_WEBHOOK_URL`)
- ✅ Telegram bot (opt-in via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)

### Phase 5 — Weekly intelligence
- ✅ `weekly-brief.js` — Sunday retrospective (regime evolution, signal perf, COT, news, takeaways, next-week setups)
- ✅ Daemon mode: auto-generate every Sunday 20:00 UTC+7

---

## 🚧 Phase 6 — Strategy backtesting

**Goal:** validate V6 indicator signals against historical scan data.

**Tasks:**
- Re-enable `legacy/backtest.js` with V6 signal logic
- Walk-forward simulation across scan_history snapshots
- Compute per-symbol/quality/direction/killzone win rates
- Generate `backtest_report.md`

**Estimated effort:** 6h

---

## 🚧 Phase 7 — Advanced data sources

**Add:**
- Options skew (CBOE PCR + IV30 from Yahoo `^VIX` derivatives)
- Open Interest tracking for futures (GC1, CL1, ES1)
- Bitcoin ETF flow daily ($MM in/out per ETF)
- Insider trading data (SEC Form 4 RSS feed)
- AAII sentiment survey (weekly retail bull/bear %)
- NAAIM exposure index (active managers' equity exposure)

**Effort:** 8h

---

## 🚧 Phase 8 — Agent intelligence layer

**Goal:** turn the system from descriptive → predictive.

**Tasks:**
- Pattern recognition on setup_history: which combos (symbol × quality × killzone × VIX state) yield highest WR?
- Position sizing recommender based on live Risk Index (smaller size when risk > 70, full when < 50)
- Auto-correlation matrix freshness alerting
- Smart catalyst clustering (e.g., NFP + earnings same day = high-vol regime)

**Effort:** 12h

---

## 🚧 Phase 9 — UI polish

**Tasks:**
- Mobile-responsive layout (current is desktop-first)
- Drag/resize panels (gridstack.js or simple flex)
- Keyboard shortcut overlay (? key = cheatsheet modal)
- Dark/light theme toggle (currently dark-only)
- Per-panel collapse state persisted in localStorage
- Better TradingView widget integration (multi-chart 2×2 grid for watchlist)

**Effort:** 10h

---

## 🚧 Phase 10 — Process management

**Tasks:**
- PM2 ecosystem.config.js (or systemd unit on Linux)
- `npm run start/stop/restart/status` scripts
- Cron entries for watchdog auto-recovery
- Graceful shutdown handler (SIGTERM → drain → exit clean)
- Health endpoint exposed via `/healthz` for k8s/docker readiness probes

**Effort:** 4h

---

## 🚧 Phase 11 — Multi-account / Multi-strategy

**Tasks:**
- Profile system (`risk-aggressive` / `risk-conservative` / `swing` / `scalp`)
- Per-profile V6 input presets stored in `profiles/*.json`
- Switch via Cmd+K palette: `PROFILE swing GO`
- Comparison panel (same setup scored against all profiles)

**Effort:** 8h

---

## 🚧 Phase 12 — Voice / TTS

**Tasks:**
- macOS `say` integration for critical alerts (already have `osascript`)
- Spoken regime narration (every 4h: "Risk on, VIX 17, Gold bullish")
- Hotkey to trigger spoken briefing

**Effort:** 2h

---

## 🚧 Phase 13 — AI Claude API integration

**Tasks:**
- `claude-narrator.js` — daemon that calls Claude API every 4h to get
  3-sentence regime narrative based on trade_brief.json
- Use Anthropic SDK with prompt caching for cost efficiency
- Render narrative in a new dashboard panel
- Optional: voice-output the narrative via `say`

**Effort:** 6h
**Requires:** `ANTHROPIC_API_KEY` env var

---

## 🚧 Phase 14 — Mobile companion app

**Tasks:**
- Generate QR code → mobile URL with simplified responsive view
- Push notifications via web Push API
- Bottom-tab interface: Brief · Watchlist · Alerts · News

**Effort:** 20h

---

## 🚧 Phase 15 — Public release

**Tasks:**
- Polish README (with GIFs/screenshots)
- Docker compose for one-command deploy
- CI: smoke-test on every push
- License decision (MIT? GPL? proprietary?)
- Publish to GitHub

**Effort:** 8h

---

## Priority order (recommended)

1. **Phase 6 (backtesting)** — validates the entire strategy is profitable before scaling
2. **Phase 10 (process mgmt)** — production-grade reliability  
3. **Phase 8 (intelligence layer)** — biggest alpha generator
4. **Phase 7 (more data)** — diminishing returns but useful
5. **Phase 13 (Claude API)** — fun and high-value if user has API key
6. **Phase 11 (profiles)** — needed if user trades multiple styles
7. **Phase 9 (UI polish)** — nice-to-have
8. **Phase 12 (voice)** — gimmicky but fun
9. **Phase 14 (mobile)** — large undertaking
10. **Phase 15 (public release)** — only if user wants to share

## Quick commands

```bash
# Check system health
curl http://localhost:3333/api/health | jq

# Run all tests
bash dashboard/smoke-test.sh

# Auto-recover dead processes
bash dashboard/watchdog.sh

# Continuous monitoring
nohup bash dashboard/watchdog.sh --loop > /tmp/watchdog.log 2>&1 &

# Generate weekly brief
node dashboard/weekly-brief.js

# Configure Discord webhook
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
# Restart setup-alerter to load env
pkill -f setup-alerter && nohup node dashboard/setup-alerter.js --daemon &
```

# NEO_CONNECTOR -- TradeBobby Dashboard
- service: tradebobby
- base_url_prod: UNKNOWN -- no production deployment found. Local-only Express server bound to `http://localhost:${PORT||3333}` (see `dashboard/server.js:8`, README "Web terminal (localhost:3333)"). Not deployed to Vercel/Render/Fly/Docker -- no infra config in repo.
- auth: none ; header: -- ; env_var: -- (no auth middleware anywhere in `dashboard/server.js`; all routes are open)
- env_required: [PORT]  # only env the HTTP API itself reads (server.js:8). PORT is optional, defaults to 3333.
- generated_at:

> NOTE FOR NEO: TradeBobby is primarily a local research desk (Pine Script strategy +
> Node.js data-collector scripts + a local dashboard). The HTTP API below is a
> **localhost-only, unauthenticated, read-mostly dashboard** with no production URL.
> It SHOULD NOT be wired as remote Neo HTTP tools unless TradeBobby is first deployed
> behind a reachable, authenticated base URL. The underlying value (scans, briefs,
> macro/news/COT JSON) is produced by CLI scripts run via `dashboard/manage.sh` /
> cron, not by remote API calls. See `## Gaps`.

## Project type
- Framework: **Express 4** (`dashboard/package.json` -> `"express": "^4.21.0"`, `"type": "module"`, start = `node server.js`). ESM. Node 22+ (README badge).
- Entry: `dashboard/server.js` (~3400 lines; one `app.listen` at server.js:3427). Routes are all defined inline in this single file.
- The rest of the repo is NOT an HTTP service: `Pro_Trading_System_V5.pine` (TradingView Pine v5 strategy) and `dashboard/*.js` data collectors (news-scanner, cot-fetcher, macro-pulse, etc.) that write JSON files the API then reads.
- Body parsing: `express.json()` only (server.js:10). Malformed JSON -> 400 `{ok:false,error:"invalid JSON"}` (server.js:12-17).
- No SSE, no WebSocket, no cron defined inside the server (scheduling is external via `manage.sh`/cron/`watchdog.sh`). Verified: zero matches for `text/event-stream`, `WebSocket`, `res.write` streaming in server.js.

## Endpoints
All paths are absolute (no router prefix). Server base = `http://localhost:3333`.
Almost every GET is "read a JSON/MD file from disk, or return a fallback if the
collector script has not run yet". `req.query`/`req.body` are ignored except where noted.

### GET /
- auth: no
- async: false
- input: none
- output: full dashboard HTML page (Content-Type text/html). Not a data API.
- errors: none
- example_curl: `curl http://localhost:3333/`

### GET /api/scan
- auth: no
- async: false
- input: none
- output: contents of `last_scan.json` (latest ICT/SMC scan: prices, signals, alerts[], timestamp) or `{}` if absent.
- errors: none (empty `{}` fallback)
- example_curl: `curl http://localhost:3333/api/scan`

### GET /api/scan-history
- auth: no
- async: false
- input: none
- output: `scan_history.json` -> `{ scans: [...] }` (per-scan price snapshots) or `{scans:[]}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/scan-history`

### GET /api/feedback
- auth: no
- async: false
- input: none
- output: `feedback.json` -> `{ notes: [{type,text,symbol,source,timestamp}] }` (max 100, oldest trimmed).
- errors: none
- example_curl: `curl http://localhost:3333/api/feedback`

### POST /api/feedback
- auth: no
- async: false
- input:
  | param  | type   | required | description |
  |--------|--------|----------|-------------|
  | text   | string | yes      | note text; trimmed; empty/non-string rejected |
  | type   | string | no       | default `"idea"` |
  | symbol | string | no       | default `""` |
  | source | string | no       | default `"USER"` |
- output: `{ ok: true, count: <total notes> }`
- errors: 400 `{ok:false,error:"text is required"}` if text missing/empty; 400 `{ok:false,error:"invalid JSON"}` if body is malformed JSON.
- example_curl: `curl -X POST http://localhost:3333/api/feedback -H 'Content-Type: application/json' -d '{"text":"GOLD looks toppy","type":"idea","symbol":"XAUUSD"}'`

### GET /api/setups
- auth: no
- async: false
- input: none
- output: result of `generateSetups()` (computed live from `generate-setups.js`); on error falls back to `live_setups.json` or `{setups:[]}`. Shape: `{ setups: [...] }`.
- errors: none (try/catch -> file fallback)
- example_curl: `curl http://localhost:3333/api/setups`

### GET /api/macro
- auth: no
- async: false
- input: none
- output: `macro_context.json` or `{}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/macro`

### GET /api/news
- auth: no
- async: false
- input: none
- output: `news_feed.json` -> `{ items: [...], sentiment?, critical_triggers? }` or `{items:[]}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/news`

### GET /api/broker
- auth: no
- async: false
- input: none
- output: `broker_positions.json` or `{ mode:"none", positions:[], note:"Broker not configured..." }`. Broker integration is optional/legacy (see `dashboard/legacy/broker-icmarkets.js`, `broker-ctrader.js`).
- errors: none
- example_curl: `curl http://localhost:3333/api/broker`

### GET /api/calendar
- auth: no
- async: false
- input: none
- output: `econ_calendar.json` -> `{ events: [...] }` or `{events:[]}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/calendar`

### GET /api/macro-pulse
- auth: no
- async: false
- input: none
- output: `macro_pulse.json` or `{data:{},note:"Run: node macro-pulse.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/macro-pulse`

### GET /api/crypto-pulse
- auth: no
- async: false
- input: none
- output: `crypto_pulse.json` or `{note:"Run: node crypto-pulse.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/crypto-pulse`

### GET /api/cot
- auth: no
- async: false
- input: none
- output: `cot.json` -> `{ markets:[...], timestamp }` or `{markets:[],note:"Run: node cot-fetcher.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/cot`

### GET /api/onchain-btc
- auth: no
- async: false
- input: none
- output: `onchain_btc.json` or `{note:"Run: node onchain-btc.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/onchain-btc`

### GET /api/earnings
- auth: no
- async: false
- input: none
- output: `earnings_cal.json` -> `{ events:[...] }` or `{events:[],note:"Run: node earnings-cal.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/earnings`

### GET /api/setup-stats
- auth: no
- async: false
- input: none
- output: `setup_stats.json` or `{note:"Run: node setup-tracker.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/setup-stats`

### GET /api/setup-history
- auth: no
- async: false
- input: none
- output: `setup_history.json` -> `{ setups:[...] }` or `{setups:[],note:"Run: node setup-tracker.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/setup-history`

### GET /api/currency-strength
- auth: no
- async: false
- input: none
- output: `currency_strength.json` or `{note:"Run: node currency-strength.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/currency-strength`

### GET /api/reddit-mania
- auth: no
- async: false
- input: none
- output: `reddit_mania.json` -> `{ top_tickers:[...] }` or `{top_tickers:[],note:"Run: node reddit-mania.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/reddit-mania`

### GET /api/pending-alerts
- auth: no
- async: false
- input: none
- output: `pending_alerts.json` -> `{ alerts:[...] }` or `{alerts:[]}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/pending-alerts`

### POST /api/dismiss-alerts
- auth: no
- async: false
- input: none (body ignored; resets the pending-alerts file)
- output: `{ ok: true }`. Side effect: overwrites `pending_alerts.json` with `{alerts:[],timestamp}`.
- errors: 400 `{ok:false,error:"invalid JSON"}` only if a malformed JSON body is sent.
- example_curl: `curl -X POST http://localhost:3333/api/dismiss-alerts`

### GET /api/trade-brief
- auth: no
- async: false
- input: none
- output: `trade_brief.json` (multi-source synthesis from trade-agent) or `{note:"Run: node trade-agent.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/trade-brief`

### GET /api/sentiment-history
- auth: no
- async: false
- input: none
- output: `sentiment_history.json` -> `{ snapshots:[...] }` or `{snapshots:[]}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/sentiment-history`

### GET /api/daily-brief.md
- auth: no
- async: false
- input: none
- output: `daily_brief.md` raw markdown (Content-Type text/markdown).
- errors: 404 markdown `# No brief yet\nRun: node trade-agent.js` if file absent.
- example_curl: `curl http://localhost:3333/api/daily-brief.md`

### GET /api/alerts
- auth: no
- async: false
- input: none
- output: consolidated alerts computed live from scan + news triggers + calendar (T-12h) + COT extremes. Shape: `{ timestamp, count, alerts:[{source:'SCAN'|'NEWS'|'CAL'|'COT', level:'CRITICAL'|'HIGH'|'MED'|'LOW', text, time}] }`, sorted by level then recency.
- errors: none
- example_curl: `curl http://localhost:3333/api/alerts`

### GET /api/correlations
- auth: no
- async: false
- input: none (uses last 30 entries of scan_history internally)
- output: `{ symbols:[...], matrix:[[...]], samples:N }` (Pearson correlation of per-symbol returns) or `{symbols:[],matrix:[],note:"Need >=3 historical scans"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/correlations`

### GET /api/profiles
- auth: no
- async: false
- input:
  | param  | type   | required | description |
  |--------|--------|----------|-------------|
  | active | string | no       | echoed back as `active`; query param only |
- output: `{ profiles:[scalp,swing,aggressive,conservative...], active }` from `profiles/*.json`.
- errors: none (`{profiles:[],active:null}` if dir absent)
- example_curl: `curl 'http://localhost:3333/api/profiles?active=swing'`

### GET /api/etf-flows
- auth: no
- async: false
- input: none
- output: `etf_flows.json` -> `{ etfs:{...} }` or `{etfs:{},note:"Run: node etf-flows.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/etf-flows`

### GET /api/backtest-report
- auth: no
- async: false
- input: none
- output: `backtest_report.json` or `{note:"Run: node backtester.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/backtest-report`

### GET /api/backtest-report.md
- auth: no
- async: false
- input: none
- output: `backtest_report.md` raw markdown (Content-Type text/markdown).
- errors: 404 markdown `# Not generated yet\nRun: node backtester.js` if absent.
- example_curl: `curl http://localhost:3333/api/backtest-report.md`

### GET /api/pattern-insights
- auth: no
- async: false
- input: none
- output: `pattern_insights.json` or `{note:"Run: node pattern-analyzer.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/pattern-insights`

### GET /api/claude-narrative
- auth: no
- async: false
- input: none
- output: `claude_narrative.json` (3-paragraph regime brief from claude-narrator) or `{note:"Run: node claude-narrator.js"}`.
- errors: none
- example_curl: `curl http://localhost:3333/api/claude-narrative`

### GET /api/weekly-brief.md
- auth: no
- async: false
- input: none
- output: `weekly_brief.md` raw markdown (Content-Type text/markdown).
- errors: 404 markdown `# Not generated yet\nRun: node weekly-brief.js` if absent.
- example_curl: `curl http://localhost:3333/api/weekly-brief.md`

### GET /api/health
- auth: no
- async: false
- input: none
- output: `{ ok, timestamp, uptime_sec, sources:{<key>:{ok,age_ms,stale}|{ok:false,missing:true}}, summary:{ok,stale,missing} }` for 12 data sources. `ok=true` when 0 missing and <3 stale.
- errors: none
- example_curl: `curl http://localhost:3333/api/health`

## Flows
No async generate -> poll -> result flow exists in the HTTP API. The real generation
happens out-of-band via CLI scripts, then the API serves the produced files:
1. A collector/agent script runs (e.g. `node trade-agent.js`, `node macro-pulse.js`,
   `node backtester.js`) -- typically scheduled by `dashboard/manage.sh` / cron / `watchdog.sh`.
2. The script writes a JSON/MD artifact (e.g. `trade_brief.json`, `macro_pulse.json`, `backtest_report.md`).
3. The matching GET endpoint reads that artifact on request. If the script has not run,
   the endpoint returns a fallback `{... note:"Run: node <script>.js"}` instead of erroring.

Outbound (not endpoints): `setup-alerter.js` pushes alerts OUT to Discord
(`DISCORD_WEBHOOK_URL`) and/or Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`).
These are outbound webhooks the project calls; TradeBobby does not expose inbound webhooks.

## Gaps
- **No production base URL.** Server binds to `localhost:3333` only; no Vercel/Docker/Render/Fly config in repo. To wire to Neo remotely, TradeBobby must first be deployed behind a reachable host. -- verify: deployment config (none found), `dashboard/manage.sh`, `dashboard/start-agent.sh`.
- **No authentication.** Every route is open. Safe only because it is localhost-bound. If exposed, it needs auth before Neo (or anything) calls it over a network. -- verify: `dashboard/server.js` (no auth middleware present).
- **Should NOT be wired as remote Neo HTTP tools as-is** (localhost + no auth + no prod URL). If Neo runs on the SAME host, the read-only GET endpoints could be polled locally; otherwise treat TradeBobby's value as CLI/artifact-based, not API-based.
- **Env vars for the HTTP service vs the project.** The HTTP server itself reads only `PORT`. The broader project's collector scripts read `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TV_MCP_DIR` (README "Optional integrations") -- these are NOT needed to call the API, only to populate its data. -- verify: README lines ~240-258, `dashboard/setup-alerter.js`, `dashboard/claude-narrator.js`, `dashboard/auto-scan.js`.
- **`/api/setups` output shape** is computed by `generate-setups.js` (`generateSetups()`); exact field list not enumerated here. -- verify: `dashboard/generate-setups.js`.
- **`/api/broker` is a stub** unless an optional broker integration in `dashboard/legacy/` is configured (MetaApi / cTrader). -- verify: `dashboard/legacy/broker-icmarkets.js`, `dashboard/legacy/broker-ctrader.js`.

## Recap
- Endpoints found: **31** (29 GET + 2 POST; `GET /` serves HTML, the other 30 are `/api/*`).
- Async (generate->poll) endpoints: **0**.
- Auth-protected endpoints: **0** (all open, localhost-only).
- Coverage in NeoBot today: **0 / 31** wired in `bot/integrations.py` (grep for `tradebobby`/`3333` -> no matches). All are NEW, but per Gaps they should NOT be wired as remote HTTP tools until a deployed, authenticated base URL exists.

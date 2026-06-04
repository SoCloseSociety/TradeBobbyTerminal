// TradeBobby Dashboard v2 — with tooltips, feedback, manual trades
import express from 'express';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3333', 10);
const app = express();
app.use(express.json());
// Handle malformed JSON gracefully
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'invalid JSON' });
  }
  next(err);
});

const SCAN_PATH = join(__dirname, 'last_scan.json');
const FEEDBACK_PATH = join(__dirname, 'feedback.json');

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// Init files if needed
if (!existsSync(FEEDBACK_PATH)) writeJSON(FEEDBACK_PATH, { notes: [] });

const SETUPS_PATH = join(__dirname, 'live_setups.json');

// Auto-generate system notes from scans
function autoFeedback(type, text, symbol) {
  const fb = readJSON(FEEDBACK_PATH) || { notes: [] };
  fb.notes.push({ type, text, symbol: symbol || '', source: 'SYSTEM', timestamp: new Date().toISOString() });
  // Keep last 100 notes only
  if (fb.notes.length > 100) fb.notes = fb.notes.slice(-100);
  writeJSON(FEEDBACK_PATH, fb);
}

// ── API ──
app.get('/api/scan', (req, res) => res.json(readJSON(SCAN_PATH) || {}));
app.get('/api/scan-history', (req, res) => res.json(readJSON(join(__dirname, 'scan_history.json')) || { scans: [] }));
app.get('/api/feedback', (req, res) => res.json(readJSON(FEEDBACK_PATH) || { notes: [] }));
import { generateSetups } from './generate-setups.js';
app.get('/api/setups', (req, res) => {
  try { res.json(generateSetups()); }
  catch (e) { res.json(readJSON(SETUPS_PATH) || { setups: [] }); }
});

app.get('/api/macro', (req, res) => {
  const macroPath = join(__dirname, 'macro_context.json');
  res.json(readJSON(macroPath) || {});
});

app.get('/api/news', (req, res) => {
  const newsPath = join(__dirname, 'news_feed.json');
  res.json(readJSON(newsPath) || { items: [] });
});

app.get('/api/broker', (req, res) => {
  const brokerPath = join(__dirname, 'broker_positions.json');
  res.json(readJSON(brokerPath) || { mode: 'none', positions: [], note: 'Broker not configured. Optional integration in legacy/ — see legacy/broker-icmarkets.js (MetaApi) or legacy/broker-ctrader.js (cTrader).' });
});

app.get('/api/calendar', (req, res) => {
  const calPath = join(__dirname, 'econ_calendar.json');
  res.json(readJSON(calPath) || { events: [] });
});

app.get('/api/macro-pulse', (req, res) => {
  res.json(readJSON(join(__dirname, 'macro_pulse.json')) || { data: {}, note: 'Run: node macro-pulse.js' });
});

app.get('/api/crypto-pulse', (req, res) => {
  res.json(readJSON(join(__dirname, 'crypto_pulse.json')) || { note: 'Run: node crypto-pulse.js' });
});

app.get('/api/cot', (req, res) => {
  res.json(readJSON(join(__dirname, 'cot.json')) || { markets: [], note: 'Run: node cot-fetcher.js' });
});

app.get('/api/onchain-btc', (req, res) => {
  res.json(readJSON(join(__dirname, 'onchain_btc.json')) || { note: 'Run: node onchain-btc.js' });
});

app.get('/api/earnings', (req, res) => {
  res.json(readJSON(join(__dirname, 'earnings_cal.json')) || { events: [], note: 'Run: node earnings-cal.js' });
});

app.get('/api/setup-stats', (req, res) => {
  res.json(readJSON(join(__dirname, 'setup_stats.json')) || { note: 'Run: node setup-tracker.js' });
});

app.get('/api/setup-history', (req, res) => {
  res.json(readJSON(join(__dirname, 'setup_history.json')) || { setups: [], note: 'Run: node setup-tracker.js' });
});

app.get('/api/currency-strength', (req, res) => {
  res.json(readJSON(join(__dirname, 'currency_strength.json')) || { note: 'Run: node currency-strength.js' });
});

app.get('/api/reddit-mania', (req, res) => {
  res.json(readJSON(join(__dirname, 'reddit_mania.json')) || { top_tickers: [], note: 'Run: node reddit-mania.js' });
});

app.get('/api/pending-alerts', (req, res) => {
  res.json(readJSON(join(__dirname, 'pending_alerts.json')) || { alerts: [] });
});

app.post('/api/dismiss-alerts', (req, res) => {
  const path = join(__dirname, 'pending_alerts.json');
  writeJSON(path, { alerts: [], timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

app.get('/api/trade-brief', (req, res) => {
  res.json(readJSON(join(__dirname, 'trade_brief.json')) || { note: 'Run: node trade-agent.js' });
});

app.get('/api/sentiment-history', (req, res) => {
  res.json(readJSON(join(__dirname, 'sentiment_history.json')) || { snapshots: [] });
});

app.get('/api/daily-brief.md', (req, res) => {
  const path = join(__dirname, 'daily_brief.md');
  if (!existsSync(path)) return res.status(404).send('# No brief yet\nRun: node trade-agent.js');
  res.set('Content-Type', 'text/markdown');
  res.send(readFileSync(path, 'utf8'));
});

// Consolidated alerts (scan + triggers + calendar T-12h + COT extremes)
app.get('/api/alerts', (req, res) => {
  const out = [];
  const scan = readJSON(SCAN_PATH);
  const news = readJSON(join(__dirname, 'news_feed.json'));
  const cal = readJSON(join(__dirname, 'econ_calendar.json'));
  const cot = readJSON(join(__dirname, 'cot.json'));
  const now = new Date();

  // Scan alerts (last scan)
  if (scan?.alerts) {
    for (const a of scan.alerts) {
      const level = a.startsWith('🔴') || a.includes('SL HIT') ? 'HIGH' : a.includes('TP2') || a.includes('FULL WIN') ? 'HIGH' : a.includes('⚠️') || a.includes('PROCHE') ? 'MED' : 'LOW';
      out.push({ source: 'SCAN', level, text: a, time: scan.timestamp });
    }
  }
  // News critical triggers
  if (news?.critical_triggers) {
    const seen = new Set();
    for (const t of news.critical_triggers) {
      const key = t.trigger;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source: 'NEWS', level: t.impact === 'EXTREME' ? 'CRITICAL' : t.impact === 'HIGH' ? 'HIGH' : 'MED',
                text: `${t.trigger.toUpperCase()} → ${t.assets?.join(',')}`, time: t.pubDate });
    }
  }
  // Upcoming calendar within 12h
  if (cal?.events) {
    for (const e of cal.events) {
      const dt = new Date(e.datetime);
      const deltaH = (dt - now) / 3600000;
      if (deltaH > 0 && deltaH < 12) {
        out.push({ source: 'CAL', level: e.impact === 'HIGH' ? 'HIGH' : e.impact === 'MEDIUM' ? 'MED' : 'LOW',
                  text: `${e.name} in ${Math.floor(deltaH)}h${String(Math.floor((deltaH-Math.floor(deltaH))*60)).padStart(2,'0')} → ${e.affects?.join(',')}`,
                  time: e.datetime });
      }
    }
  }
  // COT extremes
  if (cot?.markets) {
    for (const m of cot.markets) {
      if (!m.signal?.extreme) continue;
      out.push({ source: 'COT', level: 'MED',
                text: `${m.label} ${m.signal.bias} pctile ${m.signal.percentile_8w}`,
                time: cot.timestamp });
    }
  }

  // Sort: CRITICAL > HIGH > MED > LOW, then newest first
  const rank = { CRITICAL: 4, HIGH: 3, MED: 2, LOW: 1 };
  out.sort((a, b) => (rank[b.level] - rank[a.level]) || (new Date(b.time) - new Date(a.time)));
  res.json({ timestamp: new Date().toISOString(), count: out.length, alerts: out });
});

// Correlation matrix from scan_history (last N scans prices)
app.get('/api/correlations', (req, res) => {
  const histPath = join(__dirname, 'scan_history.json');
  const h = readJSON(histPath);
  if (!h?.scans || h.scans.length < 3) return res.json({ symbols: [], matrix: [], note: 'Need >=3 historical scans' });
  // Build per-symbol price arrays
  const scans = h.scans.slice(-30);
  const allSyms = new Set();
  scans.forEach(s => Object.keys(s.prices||{}).forEach(sym => allSyms.add(sym)));
  const symbols = [...allSyms].sort();
  const series = {};
  symbols.forEach(sym => {
    const prices = [];
    scans.forEach(s => { if (s.prices?.[sym] != null) prices.push(s.prices[sym]); });
    // Convert to returns
    const rets = [];
    for (let i = 1; i < prices.length; i++) rets.push((prices[i] - prices[i-1]) / prices[i-1]);
    series[sym] = rets;
  });
  function correl(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return null;
    const ma = a.slice(0, n), mb = b.slice(0, n);
    const avgA = ma.reduce((s,x)=>s+x,0)/n, avgB = mb.reduce((s,x)=>s+x,0)/n;
    let num=0, da=0, db=0;
    for (let i=0;i<n;i++) { const xa=ma[i]-avgA, xb=mb[i]-avgB; num+=xa*xb; da+=xa*xa; db+=xb*xb; }
    return da && db ? +(num/Math.sqrt(da*db)).toFixed(2) : null;
  }
  const matrix = symbols.map(s1 => symbols.map(s2 => s1 === s2 ? 1 : correl(series[s1], series[s2])));
  res.json({ symbols, matrix, samples: scans.length });
});

app.post('/api/feedback', (req, res) => {
  const body = req.body || {};
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }
  const fb = readJSON(FEEDBACK_PATH) || { notes: [] };
  fb.notes.push({
    type: body.type || 'idea',
    text: body.text.trim(),
    symbol: body.symbol || '',
    source: body.source || 'USER',
    timestamp: new Date().toISOString()
  });
  writeJSON(FEEDBACK_PATH, fb);
  res.json({ ok: true, count: fb.notes.length });
});

// ── PROFILES ──
app.get('/api/profiles', (req, res) => {
  const dir = join(__dirname, 'profiles');
  if (!existsSync(dir)) return res.json({ profiles: [], active: null });
  const files = ['scalp.json', 'swing.json', 'aggressive.json', 'conservative.json'];
  const profiles = files
    .map(f => { try { return readJSON(join(dir, f)); } catch { return null; } })
    .filter(Boolean);
  res.json({ profiles, active: req.query.active || null });
});

// ── ETF FLOWS (Phase 7) ──
app.get('/api/etf-flows', (req, res) => {
  res.json(readJSON(join(__dirname, 'etf_flows.json')) || { etfs: {}, note: 'Run: node etf-flows.js' });
});

// ── BACKTEST REPORT (Phase 6) ──
app.get('/api/backtest-report', (req, res) => {
  res.json(readJSON(join(__dirname, 'backtest_report.json')) || { note: 'Run: node backtester.js' });
});

// ── PATTERN INSIGHTS (Phase 8) ──
app.get('/api/pattern-insights', (req, res) => {
  res.json(readJSON(join(__dirname, 'pattern_insights.json')) || { note: 'Run: node pattern-analyzer.js' });
});

// ── CLAUDE NARRATIVE (Phase 13) ──
app.get('/api/claude-narrative', (req, res) => {
  res.json(readJSON(join(__dirname, 'claude_narrative.json')) || { note: 'Run: node claude-narrator.js' });
});

// ── WEEKLY BRIEF MD (Phase 5) ──
app.get('/api/weekly-brief.md', (req, res) => {
  const path = join(__dirname, 'weekly_brief.md');
  if (!existsSync(path)) return res.status(404).send('# Not generated yet\nRun: node weekly-brief.js');
  res.set('Content-Type', 'text/markdown');
  res.send(readFileSync(path, 'utf8'));
});

// ── BACKTEST REPORT MD (Phase 6) ──
app.get('/api/backtest-report.md', (req, res) => {
  const path = join(__dirname, 'backtest_report.md');
  if (!existsSync(path)) return res.status(404).send('# Not generated yet\nRun: node backtester.js');
  res.set('Content-Type', 'text/markdown');
  res.send(readFileSync(path, 'utf8'));
});

// ── HEALTH / STATUS ──
app.get('/api/health', (req, res) => {
  const now = Date.now();
  const sources = [
    { key: 'scan',     file: SCAN_PATH,                                stale_ms: 4 * 3600 * 1000 },
    { key: 'macro',    file: join(__dirname, 'macro_pulse.json'),      stale_ms: 30 * 60 * 1000 },
    { key: 'crypto',   file: join(__dirname, 'crypto_pulse.json'),     stale_ms: 30 * 60 * 1000 },
    { key: 'news',     file: join(__dirname, 'news_feed.json'),        stale_ms: 60 * 60 * 1000 },
    { key: 'cot',      file: join(__dirname, 'cot.json'),              stale_ms: 7 * 24 * 3600 * 1000 },
    { key: 'onchain',  file: join(__dirname, 'onchain_btc.json'),      stale_ms: 60 * 60 * 1000 },
    { key: 'earnings', file: join(__dirname, 'earnings_cal.json'),     stale_ms: 24 * 3600 * 1000 },
    { key: 'reddit',   file: join(__dirname, 'reddit_mania.json'),     stale_ms: 2 * 60 * 60 * 1000 },
    { key: 'currency', file: join(__dirname, 'currency_strength.json'),stale_ms: 30 * 60 * 1000 },
    { key: 'cal',      file: join(__dirname, 'econ_calendar.json'),    stale_ms: 24 * 3600 * 1000 },
    { key: 'brief',    file: join(__dirname, 'trade_brief.json'),      stale_ms: 30 * 60 * 1000 },
    { key: 'sentiment',file: join(__dirname, 'sentiment_history.json'),stale_ms: 30 * 60 * 1000 }
  ];
  const status = { ok: true, timestamp: new Date().toISOString(), uptime_sec: Math.round(process.uptime()), sources: {}, summary: { ok: 0, stale: 0, missing: 0 } };
  for (const s of sources) {
    if (!existsSync(s.file)) {
      status.sources[s.key] = { ok: false, missing: true };
      status.summary.missing++;
      continue;
    }
    const stat = readJSON(s.file);
    const mtime = existsSync(s.file) ? (now - Date.parse(JSON.parse(readFileSync(s.file, 'utf8'))?.timestamp || 0)) : Infinity;
    const fileMTime = now - (statSync ? statSync(s.file).mtimeMs : mtime);
    const age = isFinite(mtime) ? mtime : fileMTime;
    const stale = age > s.stale_ms;
    status.sources[s.key] = { ok: !stale, age_ms: age, stale };
    if (stale) status.summary.stale++;
    else status.summary.ok++;
  }
  status.ok = status.summary.missing === 0 && status.summary.stale < 3;
  res.json(status);
});

// ── DASHBOARD HTML ──
app.get('/', (req, res) => res.send(HTML));

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TRADEBOBBY TERMINAL</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #000;
    --bg-2: #0a0a0a;
    --bg-3: #141414;
    --bg-4: #1a1a1a;
    --border: #222;
    --border-hot: #333;
    --amber: #FFB800;
    --amber-dim: #B58400;
    --green: #00E676;
    --green-dim: #00A050;
    --red: #FF3838;
    --red-dim: #B02020;
    --yellow: #FFEB3B;
    --orange: #FF9800;
    --cyan: #00BCD4;
    --purple: #E040FB;
    --text: #E0E0E0;
    --muted: #757575;
    --faint: #4A4A4A;
  }
  body { background: var(--bg); color: var(--text); font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.4; overflow-x: hidden; }

  /* ── STATUS BAR (top, sticky) ── */
  .status-bar { background: var(--bg); border-bottom: 1px solid var(--amber); padding: 4px 10px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; font-size: 11px; position: sticky; top: 0; z-index: 600; }
  .status-bar .brand { color: var(--amber); font-weight: bold; font-size: 13px; letter-spacing: 2px; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .status-bar .brand::before { content: ''; width: 7px; height: 7px; background: var(--green); border-radius: 50%; box-shadow: 0 0 6px var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  .status-grp { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .status-cell { display: flex; flex-direction: column; line-height: 1.1; min-width: 48px; }
  .status-cell .k { color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
  .status-cell .v { font-weight: bold; font-size: 11px; white-space: nowrap; }
  .status-actions { display: flex; gap: 3px; }
  @media (max-width: 1400px) {
    .status-bar { grid-template-columns: auto 1fr auto; }
    .status-cell { min-width: 40px; }
    .status-cell .k { font-size: 7px; }
    .status-cell .v { font-size: 10px; }
  }

  /* ── TICKER BAR (scrolling prices) ── */
  .ticker { background: var(--bg-2); border-bottom: 1px solid var(--border); overflow: hidden; height: 28px; position: relative; }
  .ticker-track { display: flex; gap: 28px; padding: 6px 0; white-space: nowrap; animation: scrollT 80s linear infinite; }
  .ticker:hover .ticker-track { animation-play-state: paused; }
  @keyframes scrollT { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .tk-item { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; }
  .tk-sym { color: var(--amber); font-weight: bold; }
  .tk-px { color: var(--text); }
  .tk-up { color: var(--green); }
  .tk-dn { color: var(--red); }
  .tk-nt { color: var(--muted); }

  /* ── CRITICAL ALERT BAR ── */
  .crit-bar { background: linear-gradient(90deg, var(--red) 0%, #B02020 100%); color: #fff; padding: 6px 14px; font-size: 11px; font-weight: bold; display: none; align-items: center; gap: 10px; }
  .crit-bar.active { display: flex; animation: flash 1.2s infinite; }
  @keyframes flash { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
  .crit-bar .tag { background: #fff; color: var(--red); padding: 2px 6px; border-radius: 2px; font-size: 9px; }

  /* ── TABS ── */
  .tabs { display: flex; gap: 0; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0 8px; }
  .tab { padding: 8px 14px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; font-weight: bold; }
  .tab:hover { color: var(--text); background: var(--bg-2); }
  .tab.active { color: var(--amber); border-bottom-color: var(--amber); background: var(--bg-2); }
  .tab-content { display: none; padding: 8px; }
  .tab-content.active { display: block; }

  .header { display: none; }

  /* ── DENSE GRID (Bloomberg multi-panel) ── */
  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; padding: 6px; align-items: start; }
  .grid > .card { min-width: 0; align-self: stretch; }
  .col-3 { grid-column: span 3; }
  .col-4 { grid-column: span 4; }
  .col-5 { grid-column: span 5; }
  .col-6 { grid-column: span 6; }
  .col-7 { grid-column: span 7; }
  .col-8 { grid-column: span 8; }
  .col-9 { grid-column: span 9; }
  .col-12 { grid-column: span 12; }

  .card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; position: relative; }
  .card h2 { color: var(--amber); font-size: 10px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 1.5px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 4px; font-weight: bold; }
  .card h2::before { content: ''; width: 6px; height: 6px; background: var(--amber); display: inline-block; }
  .card.full { grid-column: 1 / -1; }

  .help { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border-radius: 50%; background: var(--border-hot); color: var(--cyan); font-size: 9px; cursor: help; position: relative; flex-shrink: 0; font-weight: bold; }
  .help:hover .tooltip { display: block; }
  .tooltip { display: none; position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--bg-4); border: 1px solid var(--cyan); padding: 8px 12px; border-radius: 2px; width: 280px; font-size: 11px; color: #ccc; line-height: 1.5; z-index: 1000; white-space: normal; box-shadow: 0 4px 12px rgba(0,0,0,0.8); text-transform: none; letter-spacing: 0; font-weight: normal; }
  .tooltip strong { color: var(--cyan); }
  .tooltip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--cyan); }

  .stat { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dotted var(--border); font-size: 11px; }
  .stat:last-child { border-bottom: none; }
  .stat .label { color: var(--muted); display: flex; align-items: center; gap: 4px; }
  .stat .value { font-weight: bold; }

  .green { color: var(--green); }
  .red { color: var(--red); }
  .yellow { color: var(--yellow); }
  .orange { color: var(--orange); }
  .cyan { color: var(--cyan); }
  .purple { color: var(--purple); }
  .amber { color: var(--amber); }
  .muted { color: var(--muted); }

  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; color: var(--amber); font-size: 9px; text-transform: uppercase; padding: 4px 5px; border-bottom: 1px solid var(--border-hot); letter-spacing: 1px; background: var(--bg); position: sticky; top: 0; }
  td { padding: 4px 5px; border-bottom: 1px solid var(--bg-3); }
  tr:hover td { background: var(--bg-3); }

  .badge { padding: 1px 5px; border-radius: 2px; font-size: 9px; font-weight: bold; letter-spacing: 0.5px; }
  .badge-long { background: rgba(0,230,118,0.15); color: var(--green); border: 1px solid var(--green-dim); }
  .badge-short { background: rgba(255,56,56,0.15); color: var(--red); border: 1px solid var(--red-dim); }
  .badge-pending { background: rgba(255,152,0,0.15); color: var(--orange); border: 1px solid #805010; }
  .badge-none { background: rgba(117,117,117,0.15); color: var(--muted); border: 1px solid var(--faint); }
  .badge-win { background: rgba(0,230,118,0.15); color: var(--green); border: 1px solid var(--green-dim); }
  .badge-loss { background: rgba(255,56,56,0.15); color: var(--red); border: 1px solid var(--red-dim); }

  /* ── HEATMAP ── */
  .heatmap { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 3px; }
  .hm-cell { padding: 6px 8px; border-radius: 2px; font-size: 10px; min-height: 48px; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; transition: transform 0.1s; border: 1px solid transparent; }
  .hm-cell:hover { transform: scale(1.04); border-color: var(--amber); z-index: 2; position: relative; }
  .hm-cell .hm-sym { font-weight: bold; font-size: 11px; letter-spacing: 0.5px; }
  .hm-cell .hm-val { font-size: 9px; opacity: 0.85; }
  .hm-cell .hm-sig { font-size: 8px; margin-top: 2px; letter-spacing: 0.5px; opacity: 0.9; }

  /* ── GAUGE (sentiment) ── */
  .gauge-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; }
  .gauge { text-align: center; position: relative; padding: 4px; }
  .gauge svg { width: 100%; max-width: 86px; height: auto; }
  .gauge-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .gauge-val { font-size: 11px; font-weight: bold; margin-top: 1px; }

  /* ── HEATMAP FILTER CHIPS ── */
  .hm-filter { background: var(--bg); border: 1px solid var(--border); color: var(--muted); padding: 2px 6px; border-radius: 2px; cursor: pointer; font-family: inherit; font-size: 9px; font-weight: bold; letter-spacing: 0.5px; }
  .hm-filter:hover { color: var(--text); border-color: var(--amber); }
  .hm-filter.active { color: var(--amber); border-color: var(--amber); background: rgba(255,184,0,0.1); }

  /* ── NEWS TICKER (bottom rolling) ── */
  .news-ticker { position: fixed; bottom: 0; left: 0; right: 0; background: var(--bg); border-top: 1px solid var(--amber); height: 26px; overflow: hidden; z-index: 500; display: flex; align-items: center; }
  .news-ticker .tag { background: var(--amber); color: var(--bg); padding: 6px 10px; font-weight: bold; font-size: 10px; letter-spacing: 1.5px; flex-shrink: 0; }
  .news-ticker-track { display: flex; gap: 40px; white-space: nowrap; animation: scrollN 180s linear infinite; padding-left: 20px; }
  .news-ticker:hover .news-ticker-track { animation-play-state: paused; }
  @keyframes scrollN { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .news-ticker-item { font-size: 11px; display: inline-flex; gap: 6px; align-items: center; }
  .news-ticker-item .cat { color: var(--cyan); font-size: 9px; letter-spacing: 1px; }
  .news-ticker-item.crit { color: var(--red); font-weight: bold; }
  body { padding-bottom: 30px; }  /* room for fixed bottom news ticker */

  /* ── SPARK / CHART ── */
  .spark { height: 32px; width: 100%; }

  /* ── DROPCAP STATS ── */
  .big-num { font-size: 22px; font-weight: bold; line-height: 1; }
  .mini-num { font-size: 10px; color: var(--muted); }

  .btn { border: 1px solid transparent; padding: 4px 10px; border-radius: 2px; cursor: pointer; font-family: inherit; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .btn-primary { background: var(--cyan); color: #000; border-color: var(--cyan); }
  .btn-primary:hover { background: #4DD0E1; }
  .btn-green { background: var(--green); color: #000; border-color: var(--green); }
  .btn-green:hover { background: #69F0AE; }
  .btn-red { background: var(--red); color: #fff; border-color: var(--red); }
  .btn-red:hover { background: #FF6060; }
  .btn-orange { background: var(--amber); color: #000; border-color: var(--amber); }
  .btn-orange:hover { background: #FFC840; }
  .btn-ghost { background: transparent; color: var(--amber); border-color: var(--amber); }
  .btn-ghost:hover { background: rgba(255,184,0,0.12); }
  .btn-sm { padding: 3px 8px; font-size: 9px; }

  .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center; }
  .modal.show { display: flex; }
  .modal-box { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; width: 400px; max-width: 90vw; }
  .modal-box h3 { color: #00E676; margin-bottom: 16px; }
  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; color: #9E9E9E; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; }
  .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; background: #111; border: 1px solid #333; border-radius: 4px; color: white; font-family: inherit; font-size: 13px; }
  .form-group textarea { height: 80px; resize: vertical; }
  .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

  .feedback-list { max-height: 340px; overflow-y: auto; }
  .feedback-item { background: var(--bg); border-left: 3px solid var(--cyan); padding: 6px 10px; margin-bottom: 4px; font-size: 11px; }
  .feedback-item .meta { color: var(--faint); font-size: 9px; margin-top: 2px; }
  .feedback-item.bug { border-left-color: var(--red); }
  .feedback-item.idea { border-left-color: var(--green); }
  .feedback-item.trade { border-left-color: var(--yellow); }

  .sparkline-box { padding: 2px 0; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border-hot); }
  ::-webkit-scrollbar-thumb:hover { background: var(--amber); }

  /* LAB sub-tabs */
  .lab-subtab { padding: 8px 16px; cursor: pointer; color: var(--muted); border-right: 1px solid var(--border); font-size: 10px; font-weight: bold; letter-spacing: 1.5px; }
  .lab-subtab:hover { background: var(--bg-3); color: var(--text); }
  .lab-subtab.active { color: var(--amber); background: var(--bg-3); }

  /* INTEL cards */
  .intel-card { background: var(--bg); border-left: 2px solid var(--cyan); padding: 6px 10px; margin-bottom: 4px; font-size: 11px; }
  .intel-card .meta { color: var(--muted); font-size: 9px; margin-top: 2px; }
  .intel-card.crit { border-left-color: var(--red); background: rgba(255,56,56,0.05); }
  .intel-card .cat { color: var(--amber); font-size: 9px; letter-spacing: 1px; font-weight: bold; }

  @media (max-width: 1200px) { .col-3 { grid-column: span 6; } .col-4 { grid-column: span 6; } .col-5 { grid-column: span 6; } }
  @media (max-width: 800px) { .col-3, .col-4, .col-5, .col-6, .col-7, .col-8, .col-9 { grid-column: span 12; } }
</style>
</head>
<body>

<!-- STATUS BAR (always visible Bloomberg-style — grouped denser cells) -->
<div class="status-bar">
  <div class="brand">TRADEBOBBY · TERMINAL</div>
  <div class="status-grp">
    <div class="status-cell"><span class="k">REGIME</span><span class="v" id="sbRegime">—</span></div>
    <div class="status-cell"><span class="k">VIX</span><span class="v" id="sbVol">—</span></div>
    <div class="status-cell"><span class="k">DXY</span><span class="v" id="sbDxy">—</span></div>
    <div class="status-cell"><span class="k">GOLD</span><span class="v" id="sbGold">—</span></div>
    <div class="status-cell"><span class="k">WTI</span><span class="v" id="sbOil">—</span></div>
    <div class="status-cell"><span class="k">F&G</span><span class="v" id="sbFng">—</span></div>
    <div class="status-cell"><span class="k">10Y</span><span class="v" id="sbYield">—</span></div>
    <div class="status-cell"><span class="k">NEWS</span><span class="v" id="sbNews">—</span></div>
    <div class="status-cell"><span class="k">TRIG</span><span class="v" id="sbTrig">—</span></div>
    <div class="status-cell"><span class="k">SESS</span><span class="v" id="sbSession">—</span></div>
    <div class="status-cell"><span class="k">UTC+7</span><span class="v amber" id="sbClock">—</span></div>
    <div class="status-cell"><span class="k">SCAN</span><span class="v muted" id="sbUpdate">—</span></div>
    <div class="status-cell"><span class="k">MCP</span><span class="v muted" id="sbMcp">—</span></div>
    <span style="display:none;" id="sbRiskOff">—</span>
  </div>
  <div class="status-actions">
    <button class="btn btn-ghost" onclick="openCmdPalette()" title="Cmd+K">⌘K</button>
    <button class="btn btn-ghost" onclick="refresh()" title="R">⟳</button>
    <button class="btn btn-ghost" onclick="openBriefModal()" title="B">📄 BRIEF</button>
    <button class="btn btn-orange" onclick="openModal('feedbackModal')" title="N">NOTE</button>
  </div>
</div>

<!-- LIVE PRICE TICKER -->
<div class="ticker"><div class="ticker-track" id="tickerTrack">Loading ticker...</div></div>

<!-- LIVE NEWS HEADLINES TICKER (fixed bottom, like CNBC crawl) -->
<div class="news-ticker">
  <div class="tag">📰 LIVE</div>
  <div class="news-ticker-track" id="newsTickerTrack">Loading headlines...</div>
</div>

<!-- CATALYST COUNTDOWN (next high-impact econ event) -->
<div id="catalystBar" style="display:none;background:#0f0f0f;border-bottom:1px solid var(--amber);padding:5px 14px;font-size:11px;color:var(--text);align-items:center;gap:10px;justify-content:center;"></div>

<!-- A+ SETUP ALERT BANNER (animated when triggered) -->
<div id="setupAlertBar" style="display:none;background:linear-gradient(90deg,#00C853 0%,#1B5E20 100%);color:#000;padding:6px 14px;font-size:11px;font-weight:bold;border-bottom:2px solid #00E676;align-items:center;gap:10px;justify-content:center;"></div>

<!-- COMMAND PALETTE (Cmd+K / Ctrl+K) -->
<div id="cmdPalette" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;justify-content:center;align-items:flex-start;padding-top:80px;">
  <div style="background:#0a0a0a;border:1px solid var(--amber);border-radius:4px;width:560px;max-width:90vw;box-shadow:0 8px 30px rgba(255,184,0,0.3);">
    <input id="cmdInput" placeholder="XAU DES · BTC GIP · EUR CN · symbol/keyword/action…" autocomplete="off"
      style="width:100%;padding:12px 14px;background:#000;border:none;outline:none;color:var(--amber);font-family:inherit;font-size:13px;border-bottom:1px solid var(--border);">
    <div id="cmdResults" style="max-height:400px;overflow-y:auto;font-size:11px;"></div>
    <div style="padding:6px 10px;background:#0a0a0a;border-top:1px solid var(--border);font-size:9px;color:var(--muted);">↑↓ navigate · ↵ open · ESC close · Cmd+K toggle</div>
  </div>
</div>

<!-- SYMBOL DETAIL MODAL (click any symbol to see unified data) -->
<div id="symModal" class="modal">
  <div class="modal-box" style="width:760px;max-width:96vw;background:#0a0a0a;border-color:var(--amber);">
    <h3 id="symModalTitle" style="display:flex;justify-content:space-between;align-items:center;color:var(--amber);">Symbol Detail</h3>
    <div id="symModalBody" style="font-size:11px;line-height:1.6;"></div>
    <div class="form-actions">
      <button class="btn btn-orange" onclick="closeModal('symModal')">Close</button>
    </div>
  </div>
</div>

<!-- DAILY BRIEF MD VIEWER MODAL -->
<div id="briefModal" class="modal">
  <div class="modal-box" style="width:780px;max-width:96vw;background:#0a0a0a;border-color:var(--cyan);max-height:90vh;overflow-y:auto;">
    <h3 style="display:flex;justify-content:space-between;align-items:center;color:var(--cyan);">Daily Brief
      <span style="display:flex;gap:6px;">
        <a id="briefDownload" download="daily_brief.md" href="/api/daily-brief.md" class="btn btn-ghost btn-sm" style="text-decoration:none;">⬇ DOWNLOAD MD</a>
        <button class="btn btn-orange btn-sm" onclick="copyBriefToClipboard()">📋 COPY</button>
      </span>
    </h3>
    <pre id="briefBody" style="font-family:'SF Mono',monospace;font-size:11px;color:var(--text);white-space:pre-wrap;background:#000;padding:14px;border-radius:2px;border:1px solid var(--border);max-height:65vh;overflow-y:auto;"></pre>
    <div class="form-actions"><button class="btn btn-orange" onclick="closeModal('briefModal')">Close</button></div>
  </div>
</div>

<!-- CRITICAL ALERT BAR -->
<div class="crit-bar" id="critBar"></div>

<!-- MCP STATUS BAR (warning when degraded) -->
<div id="mcpBanner" style="display:none;background:#332200;border-bottom:1px solid var(--orange);padding:5px 14px;font-size:11px;color:var(--orange);"></div>

<!-- DATA FRESHNESS BAR (shows age of every data source) -->
<div id="freshnessBar" style="display:flex;background:#080808;border-bottom:1px solid var(--border);padding:3px 10px;font-size:9px;color:var(--muted);overflow-x:auto;gap:10px;white-space:nowrap;align-items:center;"></div>

<!-- TABS -->
<div class="tabs">
  <div class="tab active" data-tab="terminal" onclick="switchTab(event,'terminal')">⦿ Terminal</div>
  <div class="tab" data-tab="scanner" onclick="switchTab(event,'scanner')">Markets</div>
  <div class="tab" data-tab="intel" onclick="switchTab(event,'intel')">Intel</div>
  <div class="tab" data-tab="geo" onclick="switchTab(event,'geo')">Macro</div>
  <div class="tab" data-tab="notes" onclick="switchTab(event,'notes')">Notes</div>
</div>

<!-- TAB: TERMINAL (dense Bloomberg market-intel panel) -->
<div class="tab-content active" id="tab-terminal">
<div class="grid">

  <!-- ROW 0a: Composite Risk Index (BIG number) + Market Wrap -->
  <div class="card col-3" style="border-left:3px solid var(--amber);background:#000;">
    <h2>🎚 Risk Index <span class="help">?<span class="tooltip"><strong>Composite Risk Index 0-100</strong><br>Synthese unique de toutes les sources: VIX, term structure, yield curve, sectors, credit, news risk-off, triggers, F&G crypto, retail mania.<br>0 = panic · 50 = neutral · 100 = euphoric (top warning).</span></span></h2>
    <div id="riskIndex" style="text-align:center;padding:8px 4px;">Loading…</div>
  </div>
  <div class="card col-9" style="border-left:3px solid var(--amber);background:linear-gradient(180deg,#0a0a0a 0%,#000 100%);">
    <h2>📡 Market Wrap <span class="help">?<span class="tooltip">Synthese narrative auto-generee depuis l'agent. Lis-le comme un brief Bloomberg avant la session.</span></span></h2>
    <div id="marketWrap" style="font-size:12px;line-height:1.7;color:var(--text);">Loading…</div>
  </div>

  <!-- ROW 0b: Agent Brief (multi-source structured synthesis) -->
  <div class="card col-12" style="border-left:3px solid var(--cyan);">
    <h2>🤖 Agent Brief — Multi-Source Synthesis <span class="help">?<span class="tooltip">Synthese auto de toutes les sources (scan, macro, COT, news, on-chain, currency, retail). Donne regime, top ideas avec score boosté par convergences, divergences détectées, catalysts à venir.</span></span> <a href="/api/daily-brief.md" target="_blank" style="margin-left:auto;color:var(--cyan);font-size:9px;text-decoration:none;">📄 MD EXPORT</a></h2>
    <div id="agentBrief">Loading…</div>
  </div>

  <!-- ROW 1: Market State + Top Signal + Watchlist + Killzones -->
  <div class="card col-3">
    <h2>⚙️ Market State</h2>
    <div id="regimeBox">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>🎯 Top Signal Now</h2>
    <div id="bestSetup">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>⭐ Watchlist <span class="help">?<span class="tooltip">Symboles starres (clic dans heatmap ou Cmd+K). Persiste en localStorage.</span></span> <span style="margin-left:auto;font-size:9px;color:var(--muted);" id="watchlistCount"></span></h2>
    <div id="watchlist" style="max-height:200px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>⚡ ICT Killzones (UTC+7)</h2>
    <div id="killzones">Loading…</div>
  </div>

  <!-- ROW 2: Heatmap (large) + WEI World Indices + Macro Bias -->
  <div class="card col-6">
    <h2>Market Heatmap <span class="help">?<span class="tooltip"><strong>Heatmap</strong><br>Vue synthetique de tous les symboles. Clic-gauche = TradingView, clic-droit = star/unstar dans watchlist. Filtre par asset class.</span></span>
      <span style="margin-left:auto;display:flex;gap:3px;font-size:9px;" id="heatmapFilters">
        <button class="hm-filter active" data-filter="all" onclick="setHeatmapFilter('all')">ALL</button>
        <button class="hm-filter" data-filter="fx" onclick="setHeatmapFilter('fx')">FX</button>
        <button class="hm-filter" data-filter="idx" onclick="setHeatmapFilter('idx')">IDX</button>
        <button class="hm-filter" data-filter="crypto" onclick="setHeatmapFilter('crypto')">CRYPTO</button>
        <button class="hm-filter" data-filter="metals" onclick="setHeatmapFilter('metals')">METALS</button>
        <button class="hm-filter" data-filter="oil" onclick="setHeatmapFilter('oil')">OIL</button>
        <button class="hm-filter" data-filter="star" onclick="setHeatmapFilter('star')">★</button>
      </span>
    </h2>
    <div class="heatmap" id="heatmap">Loading…</div>
  </div>

  <div class="card col-3">
    <h2>🌍 WEI World Indices <span class="help">?<span class="tooltip"><strong>World Equity Indices</strong><br>Snapshot indices globaux: SPX/NAS/DAX/CAC + futures. Vue Bloomberg-style.</span></span></h2>
    <div id="weiPanel" style="max-height:300px;overflow-y:auto;">Loading…</div>
  </div>

  <div class="card col-3">
    <h2>🧭 Macro Bias <span class="help">?<span class="tooltip"><strong>Macro Bias Matrix</strong><br>Biais geopolitique/institutionnel par asset. Issu de macro_context.json — wars, tariffs, sanctions, central banks.</span></span></h2>
    <div id="macroBias" style="max-height:300px;overflow-y:auto;">Loading…</div>
  </div>

  <!-- ROW 3: Cross-Asset + Top Movers + Vol/Squeeze + Live Broker -->
  <div class="card col-3">
    <h2>🔗 Cross-Asset</h2>
    <div id="crossAsset">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>🚀 Top Movers <span class="help">?<span class="tooltip"><strong>Top Movers</strong><br>Plus gros mouvements % entre les 2 derniers scans. Vert = up, Rouge = down. Aide a reperer le momentum intra-day.</span></span></h2>
    <div id="topMovers">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>⚡ Vol / Squeeze <span class="help">?<span class="tooltip"><strong>Volatility Ranking</strong><br>Squeeze 🟢 = compression de volatilite (bullish breakout potentiel). Range = trade dans une zone. Aide a anticiper les breakouts.</span></span></h2>
    <div id="volRanking">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>💼 Broker Live <span class="help">?<span class="tooltip">Positions reelles ouvertes sur ton broker (cTrader/MetaApi). Si rien = broker non connecte, ce n est pas grave.</span></span></h2>
    <div id="brokerLive">Loading…</div>
  </div>

  <!-- ROW 3.5: Macro Pulse + Crypto Pulse + Yield Curve -->
  <div class="card col-4">
    <h2>📈 Macro Pulse <span class="help">?<span class="tooltip"><strong>Macro Pulse</strong><br>DXY (USD), VIX (vol), US Treasury yields. Issu de Yahoo Finance via macro-pulse.js. VIX&lt;15 = complacent (long bias), &gt;25 = stress (short bias). Inverted curve = recession signal.</span></span></h2>
    <div id="macroPulse">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>🪙 Crypto Pulse <span class="help">?<span class="tooltip"><strong>Crypto Pulse</strong><br>Fear &amp; Greed Index (alternative.me), BTC dominance (CoinGecko), funding rates Binance. F&amp;G&lt;20 = contrarian LONG. Funding &gt;0.05% = longs crowded (squeeze risk).</span></span></h2>
    <div id="cryptoPulse">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>📉 Yield Curve & Vol <span class="help">?<span class="tooltip"><strong>Yield Curve</strong><br>10Y-3M spread. INVERTED = recession signal historique. NORMAL = expansion. VIX = peur sur SPX.</span></span></h2>
    <div id="yieldCurve">Loading…</div>
  </div>

  <!-- ROW 4: Calendar + Key Levels + Pos Calc -->
  <div class="card col-4">
    <h2>📅 Economic Calendar</h2>
    <div id="econCalendar" style="max-height:230px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-5">
    <h2>🎯 Key Levels (PDH/PDL/PWH/PWL)</h2>
    <div id="keyLevels" style="max-height:230px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-3">
    <h2>🧮 Position Size</h2>
    <div style="font-size:11px;">
      <div class="form-group" style="margin-bottom:5px;"><label style="font-size:9px;">Balance ($)</label><input id="psBal" type="number" value="200" style="padding:3px;font-size:11px;"></div>
      <div class="form-group" style="margin-bottom:5px;"><label style="font-size:9px;">Risk %</label><input id="psRisk" type="number" step="0.1" value="1" style="padding:3px;font-size:11px;"></div>
      <div class="form-group" style="margin-bottom:5px;"><label style="font-size:9px;">SL distance (pts)</label><input id="psSL" type="number" step="0.01" style="padding:3px;font-size:11px;"></div>
      <div class="form-group" style="margin-bottom:5px;"><label style="font-size:9px;">Symbol</label>
        <select id="psSym" style="padding:3px;font-size:11px;">
          <option value="forex">FX major</option><option value="jpy">FX JPY</option>
          <option value="xauusd">XAUUSD</option><option value="xagusd">XAGUSD</option>
          <option value="oil">USOIL/UKOIL</option><option value="nas">NAS100/SPX500</option>
          <option value="crypto">BTC/ETH/SOL/XRP</option>
        </select>
      </div>
      <button class="btn btn-orange btn-sm" onclick="calcPosition()" style="width:100%;">CALCULATE</button>
      <div id="psResult" style="margin-top:6px;font-size:10px;line-height:1.4;"></div>
    </div>
  </div>

  <!-- ROW 5: Alerts Center (col-7) + Sentiment Trend Chart (col-5) -->
  <div class="card col-7">
    <h2>🚨 Alerts Center <span class="help">?<span class="tooltip">Alertes consolidees: scan signals, news triggers, calendar T-12h, COT extremes. Triees par level.</span></span></h2>
    <div id="alertsCenter" style="max-height:230px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-5">
    <h2>📈 Sentiment Trend (24h) <span class="help">?<span class="tooltip">Trajectoire 24h du Risk Index, VIX, F&G, gold/oil sentiment depuis l'agent. Vois si le mood degrade ou s'ameliore.</span></span></h2>
    <canvas id="sentimentChart" height="120" style="width:100%;background:#000;"></canvas>
    <div id="sentimentLegend" style="font-size:9px;color:var(--muted);margin-top:4px;line-height:1.4;"></div>
  </div>

  <!-- ROW 6: Sector Rotation + COT positioning + On-chain BTC -->
  <div class="card col-4">
    <h2>🔄 Sector Rotation <span class="help">?<span class="tooltip"><strong>Sector ETFs intraday change.</strong><br>Risk-on score &gt; risk-off score = bullish risk appetite. XLK/XLY leaders = growth. XLU/XLP/XLV leaders = defensive (risk-off).</span></span></h2>
    <div id="sectorRotation" style="max-height:280px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>🏛️ COT Positioning <span class="help">?<span class="tooltip"><strong>CFTC Commitment of Traders.</strong><br>Position institutionnelle (large speculators) — extreme long ou short est souvent contrarian. Update: vendredi pour les data du mardi precedent.</span></span></h2>
    <div id="cotPanel" style="max-height:280px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>⛓ On-Chain BTC <span class="help">?<span class="tooltip">Hashrate = securite reseau. Halving countdown = supply shock. Fees congestion = network demand. blockchain.info + mempool.space.</span></span></h2>
    <div id="onchainPanel" style="max-height:280px;overflow-y:auto;">Loading…</div>
  </div>

  <!-- ROW 6.5: Currency Strength + VIX Term + Reddit Mania -->
  <div class="card col-4">
    <h2>💱 Currency Strength <span class="help">?<span class="tooltip">Force relative des devises majeures (USD/EUR/GBP/JPY) calculee depuis le scan FX. Strongest base + weakest quote = meilleur trade FX.</span></span></h2>
    <div id="currencyStrength">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>📐 VIX Term Structure <span class="help">?<span class="tooltip"><strong>VIX 9d/30d/3m/6m</strong>: backwardation (front&gt;back) = stress = SHORT bias. Contango = calm. Le 9d/VIX ratio indique fear immediate.</span></span></h2>
    <div id="vixTerm">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>🦍 Reddit Retail Mania <span class="help">?<span class="tooltip"><strong>r/wallstreetbets + r/CryptoCurrency + r/stocks</strong>. Spike de mentions retail = attention foule = SOUVENT signal contrarian (top imminent si extreme).</span></span></h2>
    <div id="redditMania" style="max-height:250px;overflow-y:auto;">Loading…</div>
  </div>

  <!-- ROW 7: Mag-7 + Earnings + Setup Tracker -->
  <div class="card col-4">
    <h2>🔥 Mag-7 Prices <span class="help">?<span class="tooltip">Apple, Microsoft, Alphabet, Amazon, Nvidia, Meta, Tesla — drivers principaux NAS/SPX. Yahoo Finance via macro-pulse.</span></span></h2>
    <div id="mag7Panel" style="max-height:260px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>📊 Earnings Calendar (14d) <span class="help">?<span class="tooltip">Mag-7 + tickers macro key. Pre-market / after-hours impact NAS100/SPX500.</span></span></h2>
    <div id="earningsPanel" style="max-height:260px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-4">
    <h2>🎯 Signal Performance Tracker <span class="help">?<span class="tooltip"><strong>Apprentissage automatique.</strong><br>Tracker qui logue chaque setup genere par V5 et check le prix vs entry/SL/TP a chaque scan. Mesure la qualite reelle des signaux par symbole, qualite (A+/A/B/C), direction. PURE OBSERVATIONNEL — pas de trades simules.</span></span></h2>
    <div id="setupTracker" style="max-height:260px;overflow-y:auto;">Loading…</div>
  </div>

  <!-- ROW 8: Live News Stream (full feed) -->
  <div class="card col-12">
    <h2>📡 Live News Stream <span class="help">?<span class="tooltip">Toutes les 80 dernieres news scrapees (RSS Google News, refresh 15min). Plus dense que "Priority" — montre tout ce qui tombe.</span></span></h2>
    <div id="newsStream" style="max-height:340px;overflow-y:auto;">Loading…</div>
  </div>

</div>
</div>

<!-- TAB: SCANNER -->
<div class="tab-content" id="tab-scanner">
<div class="grid">
  <div class="card col-12">
    <h2>Market Scanner V5 ICT/SMC <span class="help">?<span class="tooltip"><strong>Comment lire le scanner</strong><br><strong>Struct</strong> = BOS/CHoCH. BULL = HH/HL.<br><strong>HTF</strong> = biais Daily EMA 20/50/200.<br><strong>Zone</strong> = Premium (vendre) / Discount (acheter). OTE = 0.62-0.79.<br><strong>MTF</strong> = alignement Daily/4H/Current.<br><strong>Conf</strong> = 10 facteurs ICT.<br><strong>Conv</strong> = conviction globale.</span></span></h2>
    <div id="scannerContent">Loading...</div>
  </div>
</div>
</div>

<!-- TAB: INTEL (AI / Energy / Shipping / Defense) -->
<div class="tab-content" id="tab-intel">
<div class="grid">
  <div class="card col-6">
    <h2>⚓ Shipping & Chokepoints <span class="help">?<span class="tooltip"><strong>Navires & détroits</strong><br>Hormuz (oil), Suez/Red Sea (houthi), Panama (drought), Tanker attacks, Dark fleet.</span></span></h2>
    <div id="intelShip" style="max-height:360px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>⚡ Energy (Oil/Gas/Uranium/Grid) <span class="help">?<span class="tooltip"><strong>Energie</strong><br>Oil, LNG, uranium/nucleaire, power grid, data-center demand.</span></span></h2>
    <div id="intelEnergy" style="max-height:360px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>🤖 AI / Tech / Compute <span class="help">?<span class="tooltip"><strong>IA & Tech</strong><br>Chips (Nvidia, export control), modeles, data centers, capex.</span></span></h2>
    <div id="intelAI" style="max-height:360px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>🛡️ Defense / NATO / Military</h2>
    <div id="intelDefense" style="max-height:360px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>🪙 Metals (Silver/Copper/Platinum)</h2>
    <div id="intelMetal" style="max-height:280px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>₿ Crypto / Macro / FX</h2>
    <div id="intelMacro" style="max-height:280px;overflow-y:auto;">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>Category Breakdown</h2>
    <div id="intelCats">Loading…</div>
  </div>
  <div class="card col-6">
    <h2>🔄 Correlation Matrix (last 30 scans) <span class="help">?<span class="tooltip">Correlation returns entre symboles. +1 = move ensemble, -1 = inverse, 0 = independant. Base 30 derniers scans.</span></span></h2>
    <div id="correlationMatrix" style="max-height:400px;overflow:auto;">Loading…</div>
  </div>
</div>
</div>

<!-- TAB: GEOPOLITICS -->
<div class="tab-content" id="tab-geo">
<div class="grid">
  <div class="card col-4">
    <h2>🥇 Gold Sentiment</h2>
    <div id="goldSentiment">Loading...</div>
  </div>
  <div class="card col-4">
    <h2>🛢️ Oil Sentiment</h2>
    <div id="oilSentiment">Loading...</div>
  </div>
  <div class="card col-4">
    <h2>🚨 Critical Triggers</h2>
    <div id="triggersGeo">Loading...</div>
  </div>
  <div class="card col-12">
    <h2>📰 Live News Feed (80 items) <span class="help">?<span class="tooltip">RSS Google News refresh toutes 15min. HIGH priority topics en cyan. Triggers critiques en rouge.</span></span></h2>
    <div id="newsFeed" style="max-height: 600px; overflow-y: auto;">Loading...</div>
  </div>
</div>
</div>

<!-- TAB: NOTES -->
<div class="tab-content" id="tab-notes">
<div class="grid">
  <div class="card col-8">
    <h2>Notes & Feedback <span class="help">?<span class="tooltip">Chaque note sera lue par Claude lors du prochain audit. Types: Bug / Idee / Trade.</span></span></h2>
    <div class="feedback-list" id="feedbackList">Loading...</div>
  </div>
  <div class="card col-4">
    <h2>Ajouter une Note</h2>
    <div class="form-group">
      <label>Type</label>
      <select id="noteType"><option value="bug">Bug</option><option value="idea">Idee</option><option value="trade">Trade Feedback</option></select>
    </div>
    <div class="form-group">
      <label>Symbole (optionnel)</label>
      <input id="noteSymbol" placeholder="BTCUSD">
    </div>
    <div class="form-group">
      <label>Note</label>
      <textarea id="noteText" placeholder="Ex: Le signal LONG sur BTC etait trop tard…"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitNote()">Sauvegarder</button>
  </div>
</div>
</div>

<!-- MODAL: Feedback -->
<div class="modal" id="feedbackModal">
<div class="modal-box">
  <h3>Quick Note</h3>
  <div class="form-group"><label>Quoi?</label><textarea id="quickNote" placeholder="Ce que tu veux que Claude sache pour le prochain audit..."></textarea></div>
  <div class="form-actions">
    <button class="btn btn-primary" onclick="closeModal('feedbackModal')">Annuler</button>
    <button class="btn btn-orange" onclick="submitQuickNote()">Sauvegarder</button>
  </div>
</div>
</div>

<script>
function switchTab(ev, name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  (ev ? ev.currentTarget : document.querySelector('[data-tab="'+name+'"]')).classList.add('active');
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  localStorage.setItem('activeTab', name);
  if (name === 'intel') loadIntel();
}
// Restore active tab on load
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('activeTab');
  if (saved && saved !== 'terminal') switchTab(null, saved);
});

function openModal(id) {
  document.getElementById(id).classList.add('show');
}

// ── SESSION CLOCK (UTC+7 Koh Samui) ──
function tickClock() {
  const now = new Date();
  // Convert to UTC+7
  const utc7 = new Date(now.getTime() + (7 * 3600 * 1000) + (now.getTimezoneOffset() * 60000));
  const hh = String(utc7.getUTCHours()).padStart(2,'0');
  const mm = String(utc7.getUTCMinutes()).padStart(2,'0');
  const ss = String(utc7.getUTCSeconds()).padStart(2,'0');
  document.getElementById('sbClock').textContent = hh+':'+mm+':'+ss;

  // Session detection (UTC+7 Koh Samui)
  const h = utc7.getUTCHours();
  let sess = 'DEAD';
  if (h >= 3 && h < 14) sess = 'ASIA';
  if (h >= 14 && h < 20) sess = 'LONDON';
  if (h >= 20 && h < 22) sess = 'LN/NY ⚡';
  else if (h >= 22 || h < 3) sess = 'NY';
  const cell = document.getElementById('sbSession');
  if (cell) {
    cell.textContent = sess;
    cell.className = 'v ' + (sess.includes('⚡') ? 'amber' : sess==='DEAD'?'muted':'green');
  }
}
setInterval(tickClock, 1000);
tickClock();

// ── KEYBOARD SHORTCUTS ──
const TAB_KEYS = { '1':'terminal','2':'scanner','3':'intel','4':'geo','5':'notes' };
document.addEventListener('keydown', e => {
  // Global Cmd+K / Ctrl+K opens command palette regardless of focus
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCmdPalette();
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (TAB_KEYS[k]) { switchTab(null, TAB_KEYS[k]); return; }
  if (k === 'n') openModal('feedbackModal');
  if (k === 'r') refresh();
  if (k === 'b') openBriefModal();
  if (k === 'escape') {
    document.getElementById('cmdPalette').style.display = 'none';
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
  }
});

// ── COMMAND PALETTE (⌘K) ──
const ALL_SYMBOLS = ['XAUUSD','XAGUSD','USOIL','UKOIL','BTCUSD','ETHUSD','SOLUSD','XRPUSD','EURUSD','GBPUSD','USDJPY','GBPJPY','NAS100','SPX500','DAX','CAC40'];
const ACTIONS = [
  { label: '⟳ Refresh dashboard', action: () => refresh() },
  { label: '📄 Open Daily Brief', action: () => openBriefModal() },
  { label: '🚨 Dismiss alerts', action: () => dismissAlerts() },
  { label: '🔊 Toggle audio alert', action: () => toggleAudio() },
  { label: '📋 Copy brief to clipboard', action: () => copyBriefToClipboard() },
  { label: '⚙ Switch → Terminal', action: () => switchTab(null, 'terminal') },
  { label: '⚙ Switch → Markets (Scanner)', action: () => switchTab(null, 'scanner') },
  { label: '⚙ Switch → Intel', action: () => switchTab(null, 'intel') },
  { label: '⚙ Switch → Macro', action: () => switchTab(null, 'geo') },
  { label: '⚙ Switch → Notes', action: () => switchTab(null, 'notes') },
];

let CMD_SELECTED = 0;
function openCmdPalette() {
  const p = document.getElementById('cmdPalette');
  p.style.display = 'flex';
  const inp = document.getElementById('cmdInput');
  inp.value = '';
  CMD_SELECTED = 0;
  renderCmdResults('');
  setTimeout(() => inp.focus(), 50);
}
document.addEventListener('click', e => {
  const p = document.getElementById('cmdPalette');
  if (p && e.target === p) p.style.display = 'none';
});

// Bloomberg-style "GO" function codes
const GO_FUNCTIONS = {
  'DES': { label: 'Description / detail panel', exec: (s) => openSymbolModal(s) },
  'GIP': { label: 'Graph (open chart)', exec: (s) => window.open(tvUrl(s), '_blank') },
  'GP':  { label: 'Graph (open chart)', exec: (s) => window.open(tvUrl(s), '_blank') },
  'CN':  { label: 'Company news (filter feed)', exec: (s) => { switchTab(null, 'geo'); setTimeout(() => filterNewsBySymbol(s), 100); } },
  'STAR': { label: 'Star / unstar in watchlist', exec: (s) => toggleWatchlist(s) },
  'COT': { label: 'COT positioning lookup', exec: (s) => openSymbolModal(s) },
};
function filterNewsBySymbol(s) {
  // Quick scroll to news feed and highlight items mentioning the symbol
  const nf = document.getElementById('newsFeed');
  if (nf) nf.scrollIntoView();
}

// Symbol abbreviation matching (Bloomberg-style: XAU → XAUUSD, NQ → NAS100, etc.)
const SYM_ALIASES = {
  'XAU': 'XAUUSD', 'GOLD': 'XAUUSD', 'GLD': 'XAUUSD',
  'XAG': 'XAGUSD', 'SILVER': 'XAGUSD',
  'WTI': 'USOIL', 'OIL': 'USOIL', 'CRUDE': 'USOIL',
  'BRENT': 'UKOIL',
  'BTC': 'BTCUSD', 'BITCOIN': 'BTCUSD',
  'ETH': 'ETHUSD', 'ETHEREUM': 'ETHUSD',
  'SOL': 'SOLUSD', 'XRP': 'XRPUSD',
  'EUR': 'EURUSD', 'EURO': 'EURUSD',
  'GBP': 'GBPUSD', 'POUND': 'GBPUSD', 'CABLE': 'GBPUSD',
  'JPY': 'USDJPY', 'YEN': 'USDJPY',
  'NQ': 'NAS100', 'NDX': 'NAS100', 'NASDAQ': 'NAS100',
  'ES': 'SPX500', 'SPX': 'SPX500', 'SP500': 'SPX500',
  'DE': 'DAX', 'GER': 'DAX',
  'FR': 'CAC40'
};

function resolveSymbol(input) {
  const u = input.toUpperCase().trim();
  if (ALL_SYMBOLS.includes(u)) return u;
  if (SYM_ALIASES[u]) return SYM_ALIASES[u];
  // Substring match against all symbols
  return ALL_SYMBOLS.find(s => s.includes(u));
}

function renderCmdResults(q) {
  const lc = q.toLowerCase().trim();
  const results = [];

  // BLOOMBERG-STYLE "GO" SYNTAX
  // Format: "<SYM> <CODE>" e.g. "XAU DES", "BTC GIP", "EUR CN"
  const parts = q.toUpperCase().trim().split(/\s+/);
  if (parts.length === 2 && GO_FUNCTIONS[parts[1]]) {
    const sym = resolveSymbol(parts[0]);
    if (sym) {
      const fn = GO_FUNCTIONS[parts[1]];
      results.push({
        label: '⏎ ' + sym + ' ' + parts[1] + ' GO — ' + fn.label,
        sub: 'Bloomberg-style command',
        action: () => { fn.exec(sym); document.getElementById('cmdPalette').style.display='none'; }
      });
    }
  }

  // 1. Direct symbol match (resolves alias too)
  const resolved = resolveSymbol(q);
  if (resolved) {
    results.push({
      label: '📊 ' + resolved + ' — DES (detail modal)',
      sub: 'Tip: type "' + resolved + ' DES" or "' + resolved + ' GIP" for shortcuts',
      action: () => { openSymbolModal(resolved); document.getElementById('cmdPalette').style.display='none'; }
    });
    results.push({
      label: '↗ ' + resolved + ' — open TradingView chart',
      sub: 'GIP function',
      action: () => { window.open(tvUrl(resolved), '_blank'); document.getElementById('cmdPalette').style.display='none'; }
    });
    results.push({
      label: '⭐ ' + resolved + ' — toggle watchlist',
      sub: 'STAR function',
      action: () => { toggleWatchlist(resolved); document.getElementById('cmdPalette').style.display='none'; }
    });
  }

  // 2. Substring matches (other symbols)
  ALL_SYMBOLS.forEach(s => {
    if (s === resolved) return;
    if (!lc || s.toLowerCase().includes(lc)) {
      results.push({
        label: '📊 ' + s,
        sub: 'Open detail modal',
        action: () => { openSymbolModal(s); document.getElementById('cmdPalette').style.display='none'; }
      });
    }
  });

  // 3. News matches
  if (lc.length >= 2 && LAST_NEWS?.items) {
    const matches = LAST_NEWS.items.filter(i => (i.title||'').toLowerCase().includes(lc)).slice(0, 5);
    matches.forEach(i => {
      results.push({
        label: '📰 ' + i.title.substring(0, 80),
        sub: '['+i.category+'] ' + new Date(i.pubDate).toLocaleString(),
        action: () => { if (i.link) window.open(i.link, '_blank'); document.getElementById('cmdPalette').style.display='none'; }
      });
    });
  }

  // 4. Actions
  ACTIONS.forEach(a => {
    if (!lc || a.label.toLowerCase().includes(lc)) {
      results.push({ label: a.label, sub: 'Action', action: () => { a.action(); document.getElementById('cmdPalette').style.display='none'; } });
    }
  });

  const el = document.getElementById('cmdResults');
  if (results.length === 0) {
    el.innerHTML = '<div style="padding:16px;color:var(--muted);">No results</div>';
    return;
  }
  CMD_SELECTED = Math.min(CMD_SELECTED, results.length - 1);
  let html = '';
  results.slice(0, 30).forEach((r, idx) => {
    const sel = idx === CMD_SELECTED ? 'background:rgba(255,184,0,0.15);border-left:2px solid var(--amber);' : 'border-left:2px solid transparent;';
    html += '<div data-idx="'+idx+'" class="cmd-row" style="padding:8px 14px;cursor:pointer;'+sel+'">'
      + '<div style="color:var(--text);">'+r.label+'</div>'
      + '<div style="color:var(--muted);font-size:9px;">'+r.sub+'</div>'
      + '</div>';
  });
  el.innerHTML = html;
  // Wire clicks
  el.querySelectorAll('.cmd-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx, 10);
      if (results[idx]) results[idx].action();
    });
  });
  // Store for keyboard nav
  window.__CMD_RESULTS = results;
}

document.addEventListener('keydown', e => {
  const p = document.getElementById('cmdPalette');
  if (!p || p.style.display === 'none') return;
  if (e.key === 'ArrowDown') { e.preventDefault(); CMD_SELECTED++; renderCmdResults(document.getElementById('cmdInput').value); }
  if (e.key === 'ArrowUp') { e.preventDefault(); CMD_SELECTED = Math.max(0, CMD_SELECTED-1); renderCmdResults(document.getElementById('cmdInput').value); }
  if (e.key === 'Enter') {
    e.preventDefault();
    const r = (window.__CMD_RESULTS || [])[CMD_SELECTED];
    if (r) r.action();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'cmdInput') { CMD_SELECTED = 0; renderCmdResults(e.target.value); }
});

// ── SYMBOL DETAIL MODAL ──
async function openSymbolModal(symbol) {
  const m = document.getElementById('symModal');
  const title = document.getElementById('symModalTitle');
  const body = document.getElementById('symModalBody');
  const wl = getWatchlist();
  const isStar = wl.includes(symbol);
  const starBtn = '<button onclick="toggleWatchlist(\\''+symbol+'\\');openSymbolModal(\\''+symbol+'\\');" class="btn btn-ghost btn-sm" style="margin-right:6px;">' + (isStar ? '★ STARRED' : '☆ STAR') + '</button>';
  title.innerHTML = '📊 ' + symbol + '<span style="margin-left:auto;display:flex;gap:4px;align-items:center;">' + starBtn + '<a href="'+tvUrl(symbol)+'" target="_blank" class="btn btn-orange btn-sm" style="text-decoration:none;">📈 FULL CHART</a></span>';
  body.innerHTML = 'Loading…';
  m.classList.add('show');

  const [scan, cot, news, macro, brief] = await Promise.all([
    fetch('/api/scan').then(r => r.json()),
    fetch('/api/cot').then(r => r.json()),
    fetch('/api/news').then(r => r.json()),
    fetch('/api/macro').then(r => r.json()),
    fetch('/api/trade-brief').then(r => r.json())
  ]);

  const sym = (scan.symbols||[]).find(s => s.symbol === symbol);
  const cotEntry = (cot.markets||[]).find(c => c.asset === symbol);
  const newsHits = (news.items||[]).filter(i => (i.title||'').toUpperCase().includes(symbol.replace('USD',''))).slice(0, 6);
  const briefIdea = (brief.ideas||[]).find(i => i.symbol === symbol);

  // TradingView embedded mini-widget
  const tvSyms = { XAUUSD:'OANDA:XAUUSD', XAGUSD:'OANDA:XAGUSD', USOIL:'TVC:USOIL', UKOIL:'TVC:UKOIL',
    EURUSD:'OANDA:EURUSD', GBPUSD:'OANDA:GBPUSD', GBPJPY:'OANDA:GBPJPY', USDJPY:'OANDA:USDJPY',
    BTCUSD:'COINBASE:BTCUSD', ETHUSD:'COINBASE:ETHUSD', SOLUSD:'COINBASE:SOLUSD', XRPUSD:'COINBASE:XRPUSD',
    NAS100:'OANDA:NAS100USD', SPX500:'OANDA:SPX500USD', DAX:'OANDA:DE30EUR', CAC40:'OANDA:FR40EUR'
  };
  const tvSym = tvSyms[symbol] || symbol;
  let html = '<div style="margin-bottom:10px;background:#000;border:1px solid var(--border);height:280px;">';
  html += '<iframe src="https://s.tradingview.com/widgetembed/?symbol='+encodeURIComponent(tvSym)+'&interval=240&theme=dark&style=1&toolbarbg=000000&studies=&hideideas=1&hidetoptoolbar=0&hidesidetoolbar=1" width="100%" height="280" frameborder="0" allowtransparency="true" style="background:#000;"></iframe>';
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

  // Scan data
  html += '<div><div class="amber" style="font-size:9px;margin-bottom:3px;">SCAN (V5)</div>';
  if (sym) {
    const d = sym.tf_240 || {};
    html += '<div class="stat"><span class="label">Price</span><span class="value amber">'+sym.price+'</span></div>';
    Object.keys(d).forEach(k => {
      html += '<div class="stat"><span class="label">'+k+'</span><span class="value">'+d[k]+'</span></div>';
    });
  } else html += '<div class="muted">No scan data</div>';
  html += '</div>';

  // COT
  html += '<div><div class="amber" style="font-size:9px;margin-bottom:3px;">COT POSITIONNING</div>';
  if (cotEntry?.signal) {
    const s = cotEntry.signal;
    html += '<div class="stat"><span class="label">Bias</span><span class="value">'+s.bias+'</span></div>';
    html += '<div class="stat"><span class="label">Spec %Long</span><span class="value">'+s.pct_long+'%</span></div>';
    html += '<div class="stat"><span class="label">Spec Net</span><span class="value">'+s.spec_net.toLocaleString()+'</span></div>';
    html += '<div class="stat"><span class="label">Wk Change</span><span class="value '+(s.week_change>0?'green':'red')+'">'+(s.week_change>=0?'+':'')+s.week_change.toLocaleString()+'</span></div>';
    html += '<div class="stat"><span class="label">8W Pctile</span><span class="value '+(s.percentile_8w>90?'red':s.percentile_8w<10?'green':'muted')+'">'+s.percentile_8w+(s.extreme?' 🚨':'')+'</span></div>';
  } else html += '<div class="muted">No COT data</div>';
  html += '</div>';

  // Brief idea
  html += '<div><div class="amber" style="font-size:9px;margin-bottom:3px;">AGENT IDEA</div>';
  if (briefIdea) {
    const dCol = briefIdea.direction === 'LONG' ? 'green' : 'red';
    html += '<div><span class="badge badge-'+(briefIdea.direction==='LONG'?'long':'short')+'">'+briefIdea.direction+'</span> <strong>'+briefIdea.grade+'</strong> <span class="muted">score '+briefIdea.synthesis_score+'</span></div>';
    if (briefIdea.entry) html += '<div style="margin-top:4px;">Entry <strong>'+briefIdea.entry+'</strong> · SL '+briefIdea.sl+' · TP '+(briefIdea.tp2||briefIdea.tp1||'—')+'</div>';
    html += '<div style="margin-top:4px;font-size:10px;color:var(--muted);">';
    (briefIdea.reasons||[]).slice(0, 4).forEach(r => html += '• '+r+'<br>');
    if (briefIdea.flags?.length) html += '<span class="orange">⚠ '+briefIdea.flags[0]+'</span>';
    html += '</div>';
  } else html += '<div class="muted">No agent idea for this symbol now</div>';
  html += '</div>';

  // News
  html += '<div><div class="amber" style="font-size:9px;margin-bottom:3px;">NEWS HITS</div>';
  if (newsHits.length === 0) html += '<div class="muted">No recent mentions</div>';
  else {
    newsHits.forEach(i => {
      const trig = i.triggers?.length ? ' 🚨' : '';
      html += '<div style="font-size:10px;border-left:2px solid var(--cyan);padding:2px 6px;margin-bottom:2px;">'
        + '<span class="cyan" style="font-size:8px;">['+i.category+']</span>'+trig+' '+i.title.substring(0, 100)
        + '<div class="muted" style="font-size:9px;">'+new Date(i.pubDate).toLocaleString()+'</div>'
        + '</div>';
    });
  }
  html += '</div>';

  html += '</div>';

  // Per-symbol playbook notes (localStorage)
  const pb = getPlaybook(symbol);
  html += '<div style="margin-top:12px;border-top:1px dotted var(--border);padding-top:8px;">';
  html += '<div class="amber" style="font-size:9px;margin-bottom:3px;">📓 PERSONAL PLAYBOOK · ' + symbol + ' <span class="muted" style="font-weight:normal;font-size:9px;margin-left:8px;">Notes persistantes (localStorage)</span> <span id="pbStatus" style="margin-left:8px;color:var(--green);font-size:10px;"></span></div>';
  html += '<textarea id="pbInput" placeholder="Tes notes pour '+symbol+': niveaux clés, biais persistant, plays préférés, levels à surveiller…" style="width:100%;height:90px;background:#000;border:1px solid var(--border);color:var(--text);padding:6px;font-family:inherit;font-size:11px;line-height:1.5;resize:vertical;">'+pb.replace(/</g,'&lt;')+'</textarea>';
  html += '<button class="btn btn-orange btn-sm" style="margin-top:5px;" onclick="savePlaybook(\\''+symbol+'\\')">💾 SAVE</button>';
  html += '</div>';

  body.innerHTML = html;
}

// ── DAILY BRIEF MD VIEWER ──
async function openBriefModal() {
  const m = document.getElementById('briefModal');
  const body = document.getElementById('briefBody');
  body.textContent = 'Loading…';
  m.classList.add('show');
  try {
    const md = await fetch('/api/daily-brief.md').then(r => r.text());
    body.textContent = md;
  } catch(e) { body.textContent = 'Error loading brief: ' + e.message; }
}
async function copyBriefToClipboard() {
  try {
    const md = await fetch('/api/daily-brief.md').then(r => r.text());
    await navigator.clipboard.writeText(md);
    const btn = event?.target;
    if (btn) { const t = btn.textContent; btn.textContent = '✅ COPIED'; setTimeout(() => btn.textContent = t, 1500); }
  } catch(e) {}
}

// ── DATA FRESHNESS BAR ──
async function renderFreshness() {
  const el = document.getElementById('freshnessBar');
  if (!el) return;
  const sources = [
    { k: 'scan',    api: '/api/scan',           label: 'SCAN',     stale: 4*3600*1000 },
    { k: 'macro',   api: '/api/macro-pulse',    label: 'MACRO',    stale: 30*60*1000 },
    { k: 'crypto',  api: '/api/crypto-pulse',   label: 'CRYPTO',   stale: 30*60*1000 },
    { k: 'news',    api: '/api/news',           label: 'NEWS',     stale: 60*60*1000 },
    { k: 'cot',     api: '/api/cot',            label: 'COT',      stale: 7*24*3600*1000 },
    { k: 'onchain', api: '/api/onchain-btc',    label: 'ONCHAIN',  stale: 60*60*1000 },
    { k: 'reddit',  api: '/api/reddit-mania',   label: 'REDDIT',   stale: 2*60*60*1000 },
    { k: 'curr',    api: '/api/currency-strength', label: 'CURR',  stale: 30*60*1000 },
    { k: 'cal',     api: '/api/calendar',       label: 'CAL',      stale: 24*3600*1000 },
    { k: 'earn',    api: '/api/earnings',       label: 'EARN',     stale: 24*3600*1000 },
    { k: 'brief',   api: '/api/trade-brief',    label: 'BRIEF',    stale: 30*60*1000 }
  ];
  const fmt = ms => {
    if (ms < 60_000) return Math.floor(ms/1000)+'s';
    if (ms < 3_600_000) return Math.floor(ms/60_000)+'m';
    if (ms < 86_400_000) return Math.floor(ms/3_600_000)+'h';
    return Math.floor(ms/86_400_000)+'d';
  };
  let html = '<span class="muted">DATA AGE:</span>';
  for (const s of sources) {
    let pillCol = 'muted';
    let pillTxt = '—';
    try {
      const data = await fetch(s.api).then(r => r.json());
      const ts = data.timestamp || data.last_updated || data.timestamps?.scan;
      if (ts) {
        const age = Date.now() - new Date(ts).getTime();
        pillTxt = fmt(age);
        pillCol = age > s.stale * 2 ? 'red' : age > s.stale ? 'yellow' : 'green';
      }
    } catch(e) {}
    html += '<span style="display:inline-flex;gap:3px;"><span style="color:var(--muted);">'+s.label+'</span><span class="'+pillCol+'">'+pillTxt+'</span></span>';
  }
  el.innerHTML = html;
}
setInterval(renderFreshness, 60000);

// ── AUDIO ALERT ON A+ ──
let AUDIO_ENABLED = localStorage.getItem('audioEnabled') !== 'false';
function toggleAudio() {
  AUDIO_ENABLED = !AUDIO_ENABLED;
  localStorage.setItem('audioEnabled', AUDIO_ENABLED ? 'true' : 'false');
  if (AUDIO_ENABLED) playBeep();
  alert('Audio alerts: ' + (AUDIO_ENABLED ? 'ON' : 'OFF'));
}
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 800;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch(e) {}
}
let LAST_ALERT_COUNT = 0;
async function checkAlertSound() {
  if (!AUDIO_ENABLED) return;
  try {
    const p = await fetch('/api/pending-alerts').then(r => r.json());
    const n = (p.alerts || []).length;
    if (n > LAST_ALERT_COUNT) playBeep();
    LAST_ALERT_COUNT = n;
  } catch(e) {}
}
setInterval(checkAlertSound, 15000);

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

async function submitNote() {
  const note = { type: document.getElementById('noteType').value, symbol: document.getElementById('noteSymbol').value, text: document.getElementById('noteText').value };
  await fetch('/api/feedback', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(note) });
  document.getElementById('noteText').value = '';
  refresh();
}

async function submitQuickNote() {
  const note = { type: 'idea', text: document.getElementById('quickNote').value };
  await fetch('/api/feedback', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(note) });
  document.getElementById('quickNote').value = '';
  closeModal('feedbackModal');
  refresh();
}


// ── GAUGE SVG (semi-circle) ──
function gaugeSVG(value, label, min, max) {
  // value [min..max]. Map to 0..180 degrees.
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const angle = Math.PI * (1 - pct); // from left (pi) to right (0)
  const cx = 50, cy = 45, r = 36;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const color = pct > 0.6 ? '#00E676' : pct < 0.4 ? '#FF3838' : '#FFEB3B';
  return '<svg viewBox="0 0 100 60" class="spark" style="height:56px;">'
    + '<path d="M14 45 A 36 36 0 0 1 86 45" fill="none" stroke="#222" stroke-width="6"/>'
    + '<path d="M14 45 A 36 36 0 0 1 ' + x + ' ' + y + '" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round"/>'
    + '<text x="50" y="42" text-anchor="middle" font-family="monospace" font-size="12" fill="' + color + '" font-weight="bold">' + value.toFixed(2) + '</text>'
    + '</svg>';
}

function biasColor(bias) { return bias === 'BULLISH' ? 'green' : bias === 'BEARISH' ? 'red' : 'yellow'; }
function sentimentCard(label, s) {
  const col = biasColor(s.bias);
  return '<div class="stat"><span class="label">Bias</span><span class="value ' + col + '" style="font-size:16px;">' + s.bias + '</span></div>'
       + '<div class="stat"><span class="label">Avg Score</span><span class="value">' + s.avg + '</span></div>'
       + '<div class="stat"><span class="label">Raw Sum</span><span class="value">' + s.raw + '</span></div>';
}

let LAST_NEWS = null;

async function loadGeoMonitor() {
  try {
    const news = await fetch('/api/news').then(r => r.json());
    if (!news.sentiment) return;
    LAST_NEWS = news;

    // ── SENTIMENT CARDS (Geo tab) ──
    const gold = news.sentiment.gold, oil = news.sentiment.oil;
    const gSentEl = document.getElementById('goldSentiment');
    if (gSentEl) gSentEl.innerHTML = sentimentCard('Gold', gold);
    const oSentEl = document.getElementById('oilSentiment');
    if (oSentEl) oSentEl.innerHTML = sentimentCard('Oil', oil);

    // ── TRIGGERS (Terminal + Geo) ──
    const triggers = news.critical_triggers || [];
    const unique = {};
    triggers.forEach(t => { if (!unique[t.trigger]) unique[t.trigger] = t; });
    const uniqueArr = Object.values(unique);

    // Crit bar top — EXTREME triggers only
    const extreme = uniqueArr.filter(t => t.impact === 'EXTREME');
    const crit = document.getElementById('critBar');
    if (extreme.length > 0) {
      crit.classList.add('active');
      crit.innerHTML = '<span class="tag">ALERT</span> ' + extreme.slice(0, 3).map(t => t.trigger.toUpperCase() + ' → ' + t.assets.join('/')).join(' · ');
    } else {
      crit.classList.remove('active');
      crit.innerHTML = '';
    }

    const renderTriggers = (containerId, max) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (uniqueArr.length === 0) { el.innerHTML = '<p class="muted" style="padding:6px;">No triggers</p>'; return; }
      let html = '';
      uniqueArr.slice(0, max).forEach(t => {
        const col = t.impact === 'EXTREME' ? 'var(--red)' : t.impact === 'HIGH' ? 'var(--orange)' : 'var(--yellow)';
        html += '<div style="border-left:3px solid ' + col + ';padding:4px 8px;margin-bottom:3px;background:var(--bg);font-size:10px;">';
        html += '<div style="color:' + col + ';font-weight:bold;">[' + t.impact + '] ' + t.trigger.toUpperCase() + '</div>';
        html += '<div class="muted" style="font-size:9px;">→ ' + t.assets.join(', ') + '</div>';
        html += '</div>';
      });
      el.innerHTML = html;
    };
    renderTriggers('triggersGeo', 10);

    // ── NEWS FEED (full Geo tab) ──
    const items = news.items || [];
    let feedHtml = '<div class="muted" style="margin-bottom:6px;">' + items.length + ' items · Updated ' + new Date(news.timestamp).toLocaleString() + '</div>';
    items.forEach(item => {
      const hasT = item.triggers && item.triggers.length > 0;
      const borderCol = hasT ? 'var(--red)' : item.priority === 'HIGH' ? 'var(--cyan)' : 'var(--faint)';
      const bg = hasT ? 'rgba(255,56,56,0.05)' : 'var(--bg)';
      feedHtml += '<div style="border-left:3px solid ' + borderCol + ';padding:5px 10px;margin-bottom:3px;background:' + bg + ';">';
      feedHtml += '<div style="display:flex;justify-content:space-between;">';
      feedHtml += '<span class="cyan" style="font-size:9px;font-weight:bold;letter-spacing:1px;">[' + (item.category||'') + ':' + item.topic + ']</span>';
      feedHtml += '<span class="muted" style="font-size:9px;">' + new Date(item.pubDate).toLocaleString() + '</span>';
      feedHtml += '</div>';
      feedHtml += '<div style="font-size:11px;margin:2px 0;">' + item.title + '</div>';
      const s = item.scores || { gold: item.goldScore||0, oil: item.oilScore||0 };
      let scoreLine = '';
      Object.entries(s).forEach(([k, v]) => {
        if (v > 0) scoreLine += '<span class="green" style="font-size:9px;margin-right:4px;">' + k + '+' + v + '</span>';
        if (v < 0) scoreLine += '<span class="red" style="font-size:9px;margin-right:4px;">' + k + v + '</span>';
      });
      if (scoreLine) feedHtml += '<div>' + scoreLine + '</div>';
      if (hasT) feedHtml += '<div class="red" style="font-size:9px;font-weight:bold;">🚨 ' + item.triggers.join(' · ') + '</div>';
      feedHtml += '</div>';
    });
    const nfEl = document.getElementById('newsFeed');
    if (nfEl) nfEl.innerHTML = feedHtml;

    // ── STATUS BAR: RISK-OFF ──
    const ro = news.sentiment.risk_off;
    if (ro) {
      const roEl = document.getElementById('sbRiskOff');
      const roCol = ro.level === 'HIGH' ? 'red' : ro.level === 'ELEVATED' ? 'orange' : 'green';
      roEl.className = 'v ' + roCol;
      roEl.textContent = ro.level;
    }
  } catch(e) {
    const el = document.getElementById('goldSentiment');
    if (el) el.innerHTML = '<p class="muted">News scanner not yet running. Run: node news-scanner.js</p>';
  }
}

// ── INTEL TAB (filters news by category) ──
async function loadIntel() {
  const news = LAST_NEWS || await fetch('/api/news').then(r => r.json());
  if (!news.items) return;
  const renderCat = (ids, filter, max) => {
    const list = news.items.filter(filter).slice(0, max || 20);
    return list.length === 0 ? '<p class="muted">No data</p>' : list.map(i => {
      const hasT = i.triggers && i.triggers.length;
      return '<div class="intel-card ' + (hasT?'crit':'') + '">'
        + '<div><span class="cat">['+i.topic.toUpperCase()+']</span> ' + i.title.substring(0, 180) + '</div>'
        + '<div class="meta">' + new Date(i.pubDate).toLocaleString() + (hasT ? ' · <span class="red">🚨 ' + i.triggers.join(', ') + '</span>' : '') + '</div>'
        + '</div>';
    }).join('');
  };
  const setEl = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  setEl('intelShip', renderCat([], i => i.category === 'SHIP', 25));
  setEl('intelEnergy', renderCat([], i => i.category === 'ENERGY', 25));
  setEl('intelAI', renderCat([], i => i.category === 'AI', 25));
  setEl('intelDefense', renderCat([], i => i.category === 'DEFENSE' || i.topic === 'nato', 20));
  setEl('intelMetal', renderCat([], i => i.category === 'METAL', 15));
  setEl('intelMacro', renderCat([], i => i.category === 'MACRO' || i.category === 'CRYPTO', 15));

  // Category breakdown table
  const cats = news.categories || {};
  let t = '<table><tr><th>Category</th><th>Items</th><th>Triggers</th><th>Intensity</th></tr>';
  Object.keys(cats).forEach(c => {
    const d = cats[c];
    const intensity = d.triggers > 5 ? '<span class="red">HIGH</span>' : d.triggers > 2 ? '<span class="orange">ELEVATED</span>' : '<span class="green">CALM</span>';
    t += '<tr><td><strong class="amber">'+c+'</strong></td><td>'+d.count+'</td><td>'+d.triggers+'</td><td>'+intensity+'</td></tr>';
  });
  t += '</table>';
  setEl('intelCats', t);

  // Correlation matrix
  loadCorrelations();
}

// ── BIAS DETECTOR (handles both text "BULL"/"BEAR" and emoji 📈/📉) ──
function isBullish(s) { return s && (s.includes('BULL') || s.includes('📈') || s.includes('🟢')); }
function isBearish(s) { return s && (s.includes('BEAR') || s.includes('📉') || s.includes('🔴')); }

// ── TradingView URL builder ──
const TV_EXCHANGE = {
  XAUUSD: 'OANDA', XAGUSD: 'OANDA', USOIL: 'TVC', UKOIL: 'TVC',
  EURUSD: 'OANDA', GBPUSD: 'OANDA', GBPJPY: 'OANDA', USDJPY: 'OANDA',
  BTCUSD: 'COINBASE', ETHUSD: 'COINBASE', SOLUSD: 'COINBASE', XRPUSD: 'COINBASE',
  NAS100: 'OANDA', SPX500: 'OANDA', DAX: 'OANDA', CAC40: 'OANDA'
};
const TV_TICKER = {
  NAS100: 'NAS100USD', SPX500: 'SPX500USD', DAX: 'DE30EUR', CAC40: 'FR40EUR'
};
function tvUrl(symbol) {
  const ex = TV_EXCHANGE[symbol];
  const tic = TV_TICKER[symbol] || symbol;
  return ex ? 'https://www.tradingview.com/chart/?symbol=' + ex + ':' + tic : 'https://www.tradingview.com/chart/?symbol=' + symbol;
}
function tvLink(symbol, label) {
  return '<a href="' + tvUrl(symbol) + '" target="_blank" title="Open ' + symbol + ' on TradingView" style="color:inherit;text-decoration:none;border-bottom:1px dotted var(--amber);">' + (label || symbol) + '</a>';
}

// ── INTRADAY DELTA (scan_history per-symbol price series) ──
async function loadScanHistory() {
  try {
    const h = await fetch('/api/scan-history').then(r => r.json());
    const map = {};
    (h.scans || []).forEach(snap => {
      Object.entries(snap.prices || {}).forEach(([sym, px]) => {
        if (!map[sym]) map[sym] = [];
        map[sym].push(px);
      });
    });
    window.__SCAN_HIST = map;
  } catch(e) {}
}

// ── HEATMAP CLASS GROUPS ──
const HM_CLASS = {
  fx:     ['EURUSD','GBPUSD','USDJPY','GBPJPY'],
  idx:    ['NAS100','SPX500','DAX','CAC40'],
  crypto: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD'],
  metals: ['XAUUSD','XAGUSD'],
  oil:    ['USOIL','UKOIL']
};
function getHeatmapFilter() { return localStorage.getItem('hmFilter') || 'all'; }
function setHeatmapFilter(f) {
  localStorage.setItem('hmFilter', f);
  document.querySelectorAll('.hm-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  if (window.__LAST_SCAN) renderHeatmap(window.__LAST_SCAN);
}

// ── HEATMAP + TICKER from scan ──
function renderHeatmap(scan) {
  const el = document.getElementById('heatmap');
  if (!el || !scan.symbols) return;
  window.__LAST_SCAN = scan;
  const wl = getWatchlist();
  const filter = getHeatmapFilter();
  // Apply class filter
  let symList = scan.symbols;
  if (filter !== 'all') {
    if (filter === 'star') symList = symList.filter(s => wl.includes(s.symbol));
    else symList = symList.filter(s => (HM_CLASS[filter] || []).includes(s.symbol));
  }
  // Mark filter button active state on first render
  document.querySelectorAll('.hm-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  let html = '';
  symList.forEach(s => {
    const d = s.tf_240 || {};
    const sig = d.Signal || 'NONE';
    const htf = d['HTF (D)'] || d.HTF || '';
    const struct = d.Structure || '';
    const conv = d.Conviction || '—';
    const mtf = d['MTF (D/4H/cur)'] || '';

    let bg = '#1a1a1a', fg = '#888';
    let labelText = sig.split(' ')[0];
    if (sig.includes('LONG')) { bg = 'rgba(0,230,118,0.22)'; fg = '#00E676'; }
    else if (sig.includes('SHORT')) { bg = 'rgba(255,56,56,0.22)'; fg = '#FF3838'; }
    else if (isBullish(struct) || isBullish(htf)) { bg = 'rgba(0,230,118,0.10)'; fg = '#80E0A0'; labelText = 'BULL'; }
    else if (isBearish(struct) || isBearish(htf)) { bg = 'rgba(255,56,56,0.10)'; fg = '#FF8080'; labelText = 'BEAR'; }
    else if (mtf.includes('↑↑↑')) { bg = 'rgba(0,230,118,0.05)'; fg = '#80E0A0'; labelText = 'BULL MTF'; }
    else if (mtf.includes('↓↓↓')) { bg = 'rgba(255,56,56,0.05)'; fg = '#FF8080'; labelText = 'BEAR MTF'; }

    const convCol = conv === 'VERY HIGH' ? '#FFB800' : conv === 'HIGH' ? '#00E676' : conv === 'MEDIUM' ? '#FFEB3B' : '#666';
    const subText = labelText !== 'NONE' ? labelText + (conv !== '—' ? ' · ' + conv : '') : 'no data';
    const starred = wl.includes(s.symbol);
    const starIcon = starred ? '<span style="position:absolute;top:2px;right:4px;color:var(--amber);font-size:10px;">★</span>' : '';
    // Intraday delta from scan_history (window.__SCAN_HIST)
    let deltaTxt = '';
    const hist = window.__SCAN_HIST?.[s.symbol];
    if (hist && hist.length >= 2 && s.price) {
      const prev = hist[hist.length - 2];
      const delta = ((s.price - prev) / prev) * 100;
      if (Math.abs(delta) > 0.001) {
        const dCol = delta > 0 ? '#00E676' : '#FF5252';
        deltaTxt = '<span style="position:absolute;bottom:2px;right:4px;color:'+dCol+';font-size:8px;">'+(delta>0?'+':'')+delta.toFixed(2)+'%</span>';
      }
    }
    html += '<a href="' + tvUrl(s.symbol) + '" target="_blank" class="hm-cell" data-symbol="'+s.symbol+'" oncontextmenu="event.preventDefault();toggleWatchlist(\\''+s.symbol+'\\');return false;" style="background:'+bg+';color:'+fg+';text-decoration:none;position:relative;" title="Left-click: TradingView · Right-click: star/unstar · '+sig+' · Conv '+conv+'">'
      + starIcon
      + deltaTxt
      + '<div class="hm-sym">'+s.symbol+'</div>'
      + '<div class="hm-val">'+s.price+'</div>'
      + '<div class="hm-sig" style="color:'+convCol+';">'+subText+'</div>'
      + '</a>';
  });
  el.innerHTML = html || '<p class="muted" style="padding:8px;">No symbols in current filter</p>';
}

// ── KILLZONES (ICT sessions, UTC+7 Koh Samui) ──
// Asia Killzone: 20:00-00:00 UTC+7 (= 13:00-17:00 UTC - accum phase)
// London Open: 14:00-16:00 UTC+7 (= 07:00-09:00 UTC)
// London Killzone: 14:00-18:00 UTC+7
// NY Open: 19:30-21:30 UTC+7
// NY Killzone: 19:00-22:00 UTC+7
// London/NY Overlap: 19:00-22:00 UTC+7 ← PRIME
const KILLZONES = [
  { name: 'Asia Range', start: 3, end: 7, emoji: '🌏', color: 'cyan' },        // 03-07 UTC+7
  { name: 'London Open', start: 14, end: 16, emoji: '🇬🇧', color: 'yellow' },   // 14-16 UTC+7
  { name: 'London KZ', start: 14, end: 18, emoji: '⚡', color: 'orange' },      // 14-18 UTC+7
  { name: 'NY Open', start: 19, end: 22, emoji: '🇺🇸', color: 'green' },        // 19-22 UTC+7 (LN/NY overlap)
  { name: 'NY PM', start: 22, end: 24, emoji: '🌙', color: 'muted' }           // 22-00 UTC+7
];

function renderKillzones() {
  const el = document.getElementById('killzones');
  if (!el) return;
  const now = new Date();
  const utc7 = new Date(now.getTime() + 7 * 3600 * 1000 + now.getTimezoneOffset() * 60000);
  const hour = utc7.getUTCHours() + utc7.getUTCMinutes() / 60;

  let html = '';
  KILLZONES.forEach(kz => {
    const active = hour >= kz.start && hour < kz.end;
    let status, statusCol;
    if (active) {
      const remaining = kz.end - hour;
      const rMin = Math.floor((remaining - Math.floor(remaining)) * 60);
      status = '🔴 LIVE · ' + Math.floor(remaining) + 'h' + String(rMin).padStart(2, '0') + 'm left';
      statusCol = 'red';
    } else if (hour < kz.start) {
      const untilH = kz.start - hour;
      status = 'in ' + Math.floor(untilH) + 'h' + String(Math.floor((untilH - Math.floor(untilH)) * 60)).padStart(2, '0') + 'm';
      statusCol = 'muted';
    } else {
      status = '— done';
      statusCol = 'faint';
    }
    const pad = n => String(n).padStart(2, '0');
    html += '<div class="stat">'
      + '<span class="label">' + kz.emoji + ' <span class="' + kz.color + '">' + kz.name + '</span> <span class="muted" style="font-size:9px;">' + pad(kz.start) + ':00-' + pad(kz.end) + ':00</span></span>'
      + '<span class="value ' + statusCol + '" style="font-size:10px;">' + status + '</span>'
      + '</div>';
  });
  el.innerHTML = html;
}
setInterval(renderKillzones, 30000);

// ── CROSS-ASSET (DXY proxy, yields, VIX context) ──
function renderCrossAsset(scan) {
  const el = document.getElementById('crossAsset');
  if (!el) return;

  // Derive DXY proxy from major FX pairs (dollar strength)
  const syms = scan.symbols || [];
  const find = (s) => syms.find(x => x.symbol === s);
  const eur = find('EURUSD');
  const gbp = find('GBPUSD');
  const jpy = find('USDJPY');
  const btc = find('BTCUSD');
  const xau = find('XAUUSD');
  const xag = find('XAGUSD');
  const spx = find('SPX500');
  const nas = find('NAS100');

  const getHtf = s => s?.tf_240?.['HTF (D)'] || s?.tf_240?.HTF || '—';
  const biasOf = s => isBullish(getHtf(s)) ? 'BULLISH' : isBearish(getHtf(s)) ? 'BEARISH' : 'NEUTRAL';
  const row = (label, val, bias, extra) => {
    const col = bias === 'BULLISH' ? 'green' : bias === 'BEARISH' ? 'red' : 'muted';
    const arrow = bias === 'BULLISH' ? '▲' : bias === 'BEARISH' ? '▼' : '·';
    return '<div class="stat"><span class="label">' + label + '</span><span class="value"><span class="' + col + '">' + arrow + ' ' + val + '</span> <span class="muted" style="font-size:9px;">' + (extra||'') + '</span></span></div>';
  };

  // Dollar proxy: EURUSD bearish + USDJPY bullish = USD strong
  let usdStr = 'NEUTRAL';
  const eurBias = biasOf(eur), jpyBias = biasOf(jpy);
  if (eurBias === 'BEARISH' && jpyBias === 'BULLISH') usdStr = 'BULLISH';
  else if (eurBias === 'BULLISH' && jpyBias === 'BEARISH') usdStr = 'BEARISH';

  // Risk appetite: SPX + NAS + BTC bullish count
  const spxBias = biasOf(spx), nasBias = biasOf(nas), btcBias = biasOf(btc);
  const riskOnCount = [spxBias, nasBias, btcBias].filter(b => b === 'BULLISH').length;
  const riskOffCount = [spxBias, nasBias, btcBias].filter(b => b === 'BEARISH').length;

  let html = '';
  html += row('USD Proxy', '—', usdStr, '(EUR/JPY signal)');
  html += row('EURUSD', eur?.price || '—', eurBias, getHtf(eur));
  html += row('USDJPY', jpy?.price || '—', jpyBias, getHtf(jpy));
  html += row('BTCUSD', btc?.price || '—', btcBias, getHtf(btc));
  html += row('Gold', xau?.price || '—', biasOf(xau), getHtf(xau));
  html += row('Silver', xag?.price || '—', biasOf(xag), getHtf(xag));
  html += row('SPX', spx?.price || '—', spxBias, getHtf(spx));
  html += row('NAS', nas?.price || '—', nasBias, getHtf(nas));
  // Risk appetite: account for both bull and bear counts
  let raLabel, raCol;
  if (riskOnCount >= 2) { raLabel = 'RISK-ON ' + riskOnCount + '/3'; raCol = 'green'; }
  else if (riskOffCount >= 2) { raLabel = 'RISK-OFF ' + riskOffCount + '/3'; raCol = 'red'; }
  else { raLabel = 'MIXED'; raCol = 'yellow'; }
  html += '<div class="stat"><span class="label">Risk appetite</span><span class="value ' + raCol + '">' + raLabel + '</span></div>';
  // Gold/Silver ratio
  if (xau?.price && xag?.price) {
    const ratio = (xau.price / xag.price).toFixed(1);
    const col = ratio > 90 ? 'red' : ratio < 70 ? 'green' : 'yellow';
    html += '<div class="stat"><span class="label">Gold/Silver ratio</span><span class="value ' + col + '">' + ratio + ' <span class="muted" style="font-size:9px;">(>90=silver cheap, <70=silver rich)</span></span></div>';
  }

  el.innerHTML = html;
}

// ── BROKER LIVE POSITIONS (real broker only — no paper) ──
async function renderBrokerLive(scan) {
  const el = document.getElementById('brokerLive');
  if (!el) return;
  try {
    const broker = await fetch('/api/broker').then(r => r.json());
    const positions = broker.positions || [];
    const mode = broker.mode || 'none';
    if (mode === 'none' || positions.length === 0) {
      const msg = mode === 'none'
        ? '<p class="muted" style="font-size:10px;padding:4px;">Broker non connecte.<br><span class="muted">Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node broker-ctrader.js --daemon</code></span></p>'
        : '<p class="muted" style="font-size:10px;padding:4px;">Aucune position broker ouverte.</p>';
      el.innerHTML = '<div style="font-size:9px;margin-bottom:4px;"><span class="badge badge-'+(mode==='metaapi'||mode==='ctrader'?'win':mode==='mock'?'pending':'none')+'">'+mode.toUpperCase()+'</span></div>' + msg;
      return;
    }
    const prices = {};
    (scan.symbols || []).forEach(s => prices[s.symbol] = s.price);
    let html = '<div style="font-size:9px;margin-bottom:4px;"><span class="badge badge-win">'+mode.toUpperCase()+'</span> · Eq <span class="amber">'+(broker.equity||0)+'</span> · '+positions.length+' open</div>';
    html += '<table style="font-size:10px;"><tr><th>Sym</th><th>Dir</th><th>R</th><th>P&L</th></tr>';
    positions.forEach(p => {
      const px = prices[p.symbol] || p.current;
      const isLong = p.direction === 'LONG';
      const riskPts = Math.abs((p.entry||0) - (p.sl||0));
      const pnlPts = px ? (isLong ? px - p.entry : p.entry - px) : 0;
      const rVal = riskPts > 0 ? (pnlPts / riskPts) : 0;
      const dc = isLong ? 'badge-long' : 'badge-short';
      const rCol = rVal > 0 ? 'green' : rVal < 0 ? 'red' : 'muted';
      html += '<tr><td><strong>'+tvLink(p.symbol)+'</strong></td>'
        + '<td><span class="badge '+dc+'">'+p.direction+'</span></td>'
        + '<td class="'+rCol+'">'+(rVal>=0?'+':'')+rVal.toFixed(2)+'R</td>'
        + '<td class="'+((p.profit||0)>=0?'green':'red')+'">'+(p.profit||0).toFixed(0)+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Broker unreachable</p>'; }
}

// ── TOP MOVERS (% change between last 2 scans) ──
function renderTopMovers(scan) {
  const el = document.getElementById('topMovers');
  if (!el) return;
  fetch('/api/scan').then(r=>r.json()).catch(()=>null);
  fetch('/api/correlations').then(r=>r.json()).then(data => {
    // /api/correlations gives history; we need raw scan history to compute % change
    fetch('/api/scan').then(r => r.json());
  }).catch(()=>{});
  // Use scan_history.json snapshot via embedded prices: we re-fetch via /api/correlations? Not directly available.
  // Simpler path: compute change from scan.symbols where each has .change set by news-scanner or scan.
  const syms = (scan.symbols || []).slice();
  // If scan symbols don't carry change data, derive from squeeze/range/HTF as fallback ranking
  const withChange = syms.map(s => ({
    symbol: s.symbol,
    price: s.price,
    change: typeof s.change === 'number' ? s.change : null,
    htf: (s.tf_240?.['HTF (D)'] || s.tf_240?.HTF || '')
  }));
  const haveChange = withChange.some(x => x.change !== null);
  if (!haveChange) {
    // Fallback ranking by HTF bias intensity (just show bullish/bearish ranking)
    const bull = withChange.filter(x => isBullish(x.htf));
    const bear = withChange.filter(x => isBearish(x.htf));
    let html = '<div class="muted" style="font-size:9px;margin-bottom:3px;">Pas de delta % (scan unique). Bias HTF:</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">';
    html += '<div><span class="green" style="font-size:9px;">▲ BULL</span><br>' + bull.slice(0,5).map(s => '<div>'+tvLink(s.symbol)+'</div>').join('') + '</div>';
    html += '<div><span class="red" style="font-size:9px;">▼ BEAR</span><br>' + bear.slice(0,5).map(s => '<div>'+tvLink(s.symbol)+'</div>').join('') + '</div>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }
  const sorted = withChange.filter(x => x.change !== null).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  let html = '<table style="font-size:10px;"><tr><th>Sym</th><th>Px</th><th>Δ%</th></tr>';
  sorted.slice(0, 8).forEach(s => {
    const col = s.change > 0 ? 'green' : s.change < 0 ? 'red' : 'muted';
    const arrow = s.change > 0 ? '▲' : s.change < 0 ? '▼' : '·';
    html += '<tr><td><strong>'+tvLink(s.symbol)+'</strong></td>'
      + '<td>'+s.price+'</td>'
      + '<td class="'+col+'">'+arrow+' '+(s.change>=0?'+':'')+s.change.toFixed(2)+'%</td></tr>';
  });
  html += '</table>';
  el.innerHTML = html;
}

// ── VOLATILITY / SQUEEZE RANKING ──
function renderVolRanking(scan) {
  const el = document.getElementById('volRanking');
  if (!el) return;
  const syms = (scan.symbols || []);
  const rows = syms.map(s => {
    const d = s.tf_240 || {};
    const squeeze = d.Squeeze || '';
    const range = d.Range || '';
    return { symbol: s.symbol, squeeze, range, htf: d['HTF (D)'] || d.HTF || '' };
  });
  // Squeeze ON = compressed vol → likely breakout. Rank squeeze first.
  const sq = rows.filter(r => r.squeeze.includes('🟢'));
  const inRange = rows.filter(r => r.range.includes('✅'));
  let html = '<div style="font-size:10px;">';
  html += '<div class="amber" style="font-size:9px;margin-bottom:3px;">SQUEEZE ON (' + sq.length + ')</div>';
  html += sq.length === 0 ? '<div class="muted" style="font-size:9px;">Aucun</div>'
    : '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;">' + sq.map(r => '<span style="background:rgba(0,230,118,0.12);padding:1px 5px;border-radius:2px;font-size:9px;">'+tvLink(r.symbol)+'</span>').join('') + '</div>';
  html += '<div class="amber" style="font-size:9px;margin-bottom:3px;">IN RANGE (' + inRange.length + ')</div>';
  html += inRange.length === 0 ? '<div class="muted" style="font-size:9px;">Aucun</div>'
    : '<div style="display:flex;flex-wrap:wrap;gap:3px;">' + inRange.map(r => '<span style="background:rgba(255,184,0,0.10);padding:1px 5px;border-radius:2px;font-size:9px;">'+tvLink(r.symbol)+'</span>').join('') + '</div>';
  html += '</div>';
  el.innerHTML = html;
}

// ── MACRO BIAS MATRIX (from macro_context.json) ──
async function renderMacroBias() {
  const el = document.getElementById('macroBias');
  if (!el) return;
  try {
    const m = await fetch('/api/macro').then(r => r.json());
    const biases = {};
    const collect = (arr) => (arr || []).forEach(item => {
      if (!item.bias) return;
      Object.entries(item.bias).forEach(([asset, dir]) => {
        if (!biases[asset]) biases[asset] = { LONG: 0, SHORT: 0, sources: [] };
        biases[asset][dir] = (biases[asset][dir] || 0) + 1;
        biases[asset].sources.push(item.name);
      });
    });
    collect(m.geopolitical?.wars);
    collect(m.geopolitical?.trade_wars);
    collect(m.geopolitical?.sanctions);

    // Add institutional biases (gold/silver/oil)
    const inst = m.institutional || {};
    Object.entries(inst).forEach(([k, v]) => {
      if (v.bias && typeof v.bias === 'string') {
        const asset = k === 'gold' ? 'XAUUSD' : k === 'silver' ? 'XAGUSD' : k === 'oil' ? 'USOIL' : k.toUpperCase();
        if (!biases[asset]) biases[asset] = { LONG: 0, SHORT: 0, sources: [] };
        if (v.bias.toUpperCase().includes('LONG') || v.bias.toUpperCase().includes('BULL')) biases[asset].LONG += 2;
        if (v.bias.toUpperCase().includes('SHORT') || v.bias.toUpperCase().includes('BEAR')) biases[asset].SHORT += 2;
        biases[asset].sources.push('institutional');
      }
    });

    const assets = Object.keys(biases).sort();
    if (assets.length === 0) {
      el.innerHTML = '<p class="muted">No macro bias data</p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:3px;">Updated ' + (m.last_updated || '—') + '</div>';
    html += '<table style="font-size:10px;"><tr><th>Asset</th><th>Net</th><th>Score</th></tr>';
    assets.forEach(a => {
      const b = biases[a];
      const net = b.LONG - b.SHORT;
      const dir = net > 0 ? 'LONG' : net < 0 ? 'SHORT' : 'NEUT';
      const col = net > 0 ? 'green' : net < 0 ? 'red' : 'muted';
      const arrow = net > 0 ? '▲' : net < 0 ? '▼' : '·';
      html += '<tr><td><strong>'+a+'</strong></td>'
        + '<td class="'+col+'">'+arrow+' '+dir+'</td>'
        + '<td class="muted">+'+b.LONG+'/-'+b.SHORT+'</td></tr>';
    });
    html += '</table>';
    if (m.priority_alerts?.length) {
      html += '<div style="margin-top:5px;border-top:1px dotted var(--border);padding-top:4px;">';
      html += '<div class="amber" style="font-size:8px;margin-bottom:2px;">PRIORITY</div>';
      m.priority_alerts.slice(0, 3).forEach(a => {
        html += '<div class="muted" style="font-size:9px;line-height:1.3;">• '+a+'</div>';
      });
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p class="muted">Macro context unavailable</p>';
  }
}

// ── MACRO PULSE (DXY, VIX, yields) ──
async function renderMacroPulse() {
  const el = document.getElementById('macroPulse');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const d = m.data || {};
    if (Object.keys(d).length === 0) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node macro-pulse.js</code></p>';
      return;
    }
    const cell = (key, label) => {
      const x = d[key]; if (!x) return '';
      const col = (x.changePct||0) > 0 ? 'green' : (x.changePct||0) < 0 ? 'red' : 'muted';
      const arrow = (x.changePct||0) > 0 ? '▲' : (x.changePct||0) < 0 ? '▼' : '·';
      return '<div class="stat"><span class="label">'+label+'</span><span class="value"><span class="amber">'+x.price+'</span> <span class="'+col+'">'+arrow+(x.changePct>=0?'+':'')+(x.changePct||0).toFixed(2)+'%</span></span></div>';
    };
    let html = '';
    html += cell('dxy', 'DXY');
    html += cell('vix', 'VIX');
    if (m.regime?.vol) {
      const vc = m.regime.vol === 'COMPLACENT' ? 'green' : m.regime.vol === 'NORMAL' ? 'green' : m.regime.vol === 'ELEVATED' ? 'yellow' : 'red';
      html += '<div class="stat"><span class="label">Vol Regime</span><span class="value '+vc+'">'+m.regime.vol+'</span></div>';
    }
    html += cell('move', 'MOVE (bond vol)');
    html += cell('gold_f', 'Gold Fut');
    html += cell('silver_f', 'Silver Fut');
    if (d.gold_silver_ratio) {
      const col = d.gold_silver_ratio > 90 ? 'red' : d.gold_silver_ratio < 70 ? 'green' : 'yellow';
      html += '<div class="stat"><span class="label">G/S Ratio</span><span class="value '+col+'">'+d.gold_silver_ratio+'</span></div>';
    }
    if (d.brent_wti_spread !== undefined) {
      html += '<div class="stat"><span class="label">Brent-WTI</span><span class="value muted">$'+d.brent_wti_spread.toFixed(2)+'</span></div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Macro pulse error</p>'; }
}

// ── CRYPTO PULSE (F&G, BTC dom, funding) ──
async function renderCryptoPulse() {
  const el = document.getElementById('cryptoPulse');
  if (!el) return;
  try {
    const c = await fetch('/api/crypto-pulse').then(r => r.json());
    if (!c.fear_greed && !c.dominance) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node crypto-pulse.js</code></p>';
      return;
    }
    let html = '';
    const fg = c.fear_greed;
    if (fg) {
      const col = fg.current <= 20 ? 'green' : fg.current <= 35 ? 'cyan' : fg.current <= 65 ? 'yellow' : fg.current <= 80 ? 'orange' : 'red';
      const trendCol = fg.change_1d > 0 ? 'green' : fg.change_1d < 0 ? 'red' : 'muted';
      const trendArrow = fg.change_1d > 0 ? '▲' : fg.change_1d < 0 ? '▼' : '·';
      html += '<div class="stat"><span class="label">F&amp;G Index</span><span class="value"><span class="'+col+'" style="font-size:14px;">'+fg.current+'</span> <span class="muted">'+fg.classification+'</span> <span class="'+trendCol+'" style="font-size:9px;">'+trendArrow+(fg.change_1d>=0?'+':'')+fg.change_1d+'</span></span></div>';
    }
    if (c.regime) {
      const rc = c.regime.includes('FEAR') ? 'green' : c.regime.includes('GREED') ? 'red' : 'yellow';
      html += '<div class="stat"><span class="label">Regime</span><span class="value '+rc+'">'+c.regime+'</span></div>';
    }
    if (c.signal) {
      html += '<div class="muted" style="font-size:9px;font-style:italic;border-left:2px solid var(--cyan);padding:2px 6px;margin:3px 0;">' + c.signal + '</div>';
    }
    const dom = c.dominance;
    if (dom) {
      html += '<div class="stat"><span class="label">BTC Dom</span><span class="value amber">'+dom.btc_dominance+'%</span></div>';
      html += '<div class="stat"><span class="label">ETH Dom</span><span class="value muted">'+dom.eth_dominance+'%</span></div>';
      const mcCol = dom.mcap_change_24h > 0 ? 'green' : dom.mcap_change_24h < 0 ? 'red' : 'muted';
      html += '<div class="stat"><span class="label">MCap 24h</span><span class="value '+mcCol+'">'+(dom.mcap_change_24h>=0?'+':'')+dom.mcap_change_24h+'%</span></div>';
    }
    const f = c.funding?.tracked?.BTCUSDT;
    if (f) {
      const fcol = f.funding_pct > 0.03 ? 'red' : f.funding_pct < -0.01 ? 'green' : 'muted';
      html += '<div class="stat"><span class="label">BTC Funding</span><span class="value '+fcol+'">'+(f.funding_pct>=0?'+':'')+f.funding_pct+'%</span></div>';
    }
    if (c.funding_signal) {
      html += '<div class="muted" style="font-size:9px;font-style:italic;border-left:2px solid var(--orange);padding:2px 6px;margin-top:3px;">' + c.funding_signal + '</div>';
    }
    // Top funding extreme
    if (c.funding?.topLong?.length) {
      html += '<div class="amber" style="font-size:9px;margin-top:5px;border-top:1px dotted var(--border);padding-top:3px;">FUNDING EXTREMES</div>';
      const tl = c.funding.topLong.slice(0, 3);
      const ts = c.funding.topShort.slice(0, 3);
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">';
      html += '<div><span class="red">SHORT BIAS (longs paying):</span><br>' + tl.map(t => t.symbol.replace('USDT','')+' '+t.funding_pct+'%').join('<br>') + '</div>';
      html += '<div><span class="green">LONG BIAS (shorts paying):</span><br>' + ts.map(t => t.symbol.replace('USDT','')+' '+t.funding_pct+'%').join('<br>') + '</div>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Crypto pulse error</p>'; }
}

// ── YIELD CURVE & VOL panel ──
async function renderYieldCurve() {
  const el = document.getElementById('yieldCurve');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const d = m.data || {};
    if (!d.us10y) { el.innerHTML = '<p class="muted">No yield data</p>'; return; }
    const yields = [
      { k: 'us3m', l: '3M' },
      { k: 'us5y', l: '5Y' },
      { k: 'us10y', l: '10Y' },
      { k: 'us30y', l: '30Y' }
    ];
    let html = '<table style="font-size:10px;"><tr><th>Tenor</th><th>Yield</th><th>Δ</th></tr>';
    yields.forEach(y => {
      const x = d[y.k]; if (!x) return;
      const col = (x.changePct||0) > 0 ? 'green' : 'red';
      html += '<tr><td><strong>'+y.l+'</strong></td><td class="amber">'+x.price+'%</td><td class="'+col+'">'+(x.changePct>=0?'+':'')+(x.changePct||0).toFixed(2)+'%</td></tr>';
    });
    html += '</table>';
    if (d.spread_10y_3m !== undefined) {
      const sp = d.spread_10y_3m;
      const col = sp < 0 ? 'red' : sp < 0.5 ? 'yellow' : 'green';
      const lbl = sp < 0 ? 'INVERTED 🚨' : sp < 0.5 ? 'FLAT' : 'NORMAL';
      html += '<div class="stat" style="margin-top:5px;border-top:1px dotted var(--border);padding-top:5px;"><span class="label">10Y-3M Spread</span><span class="value '+col+'">'+sp+' bps · '+lbl+'</span></div>';
    }
    if (d.spread_10y_5y !== undefined) {
      html += '<div class="stat"><span class="label">10Y-5Y</span><span class="value muted">'+d.spread_10y_5y+' bps</span></div>';
    }
    if (d.vix) {
      const vCol = d.vix.price < 15 ? 'green' : d.vix.price < 20 ? 'green' : d.vix.price < 25 ? 'yellow' : 'red';
      html += '<div class="stat"><span class="label">VIX</span><span class="value '+vCol+'">'+d.vix.price+'</span></div>';
    }
    if (d.vvix) {
      html += '<div class="stat"><span class="label">VVIX</span><span class="value muted">'+d.vvix.price+'</span></div>';
    }
    if (d.move) {
      html += '<div class="stat"><span class="label">MOVE (bond vol)</span><span class="value muted">'+d.move.price+'</span></div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Yield error</p>'; }
}

// ── SECTOR ROTATION ──
async function renderSectorRotation() {
  const el = document.getElementById('sectorRotation');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const sr = m.sector_rotation;
    const d = m.data || {};
    if (!sr) { el.innerHTML = '<p class="muted">Pas de data sector ETF</p>'; return; }
    let html = '';
    // Risk on vs off score
    const onScore = +sr.risk_on_score.toFixed(2);
    const offScore = +sr.risk_off_score.toFixed(2);
    const verdict = onScore > offScore ? 'RISK-ON' : onScore < offScore ? 'RISK-OFF' : 'MIXED';
    const vCol = verdict === 'RISK-ON' ? 'green' : verdict === 'RISK-OFF' ? 'red' : 'yellow';
    html += '<div class="stat"><span class="label">Verdict</span><span class="value '+vCol+'">'+verdict+'</span></div>';
    html += '<div class="stat"><span class="label">Risk-On Score</span><span class="value green">+'+onScore+'</span></div>';
    html += '<div class="stat"><span class="label">Risk-Off Score</span><span class="value red">'+offScore+'</span></div>';
    // Leaders + laggards
    html += '<div class="amber" style="font-size:9px;margin-top:5px;">LEADERS</div>';
    sr.leaders.forEach(s => {
      html += '<div class="stat" style="font-size:10px;"><span class="label">'+s.label+'</span><span class="value green">+'+s.chg.toFixed(2)+'%</span></div>';
    });
    html += '<div class="amber" style="font-size:9px;margin-top:5px;">LAGGARDS</div>';
    sr.laggards.forEach(s => {
      html += '<div class="stat" style="font-size:10px;"><span class="label">'+s.label+'</span><span class="value red">'+s.chg.toFixed(2)+'%</span></div>';
    });
    // Key thematic ETFs
    const themes = [['gdx','Gold Miners'],['slv','Silver ETF'],['tlt','Bonds (TLT)'],['hyg','HY Bonds'],['ibit','BTC ETF'],['smh','Semis']];
    html += '<div class="amber" style="font-size:9px;margin-top:5px;border-top:1px dotted var(--border);padding-top:3px;">THEMES</div>';
    themes.forEach(([k,l]) => {
      const x = d[k]; if (!x) return;
      const c = x.changePct > 0 ? 'green' : x.changePct < 0 ? 'red' : 'muted';
      html += '<div class="stat" style="font-size:10px;"><span class="label">'+l+'</span><span class="value"><span class="amber">'+x.price+'</span> <span class="'+c+'">'+(x.changePct>=0?'+':'')+x.changePct.toFixed(2)+'%</span></span></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Sector error</p>'; }
}

// ── COT PANEL ──
async function renderCOT() {
  const el = document.getElementById('cotPanel');
  if (!el) return;
  try {
    const c = await fetch('/api/cot').then(r => r.json());
    const markets = c.markets || [];
    if (markets.length === 0) {
      el.innerHTML = '<p class="muted">Pas de COT. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node cot-fetcher.js</code></p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:3px;">CFTC report ' + (c.report_date || '—') + '</div>';
    html += '<table style="font-size:10px;"><tr><th>Asset</th><th>Bias</th><th>%Long</th><th>Δ Wk</th><th>Pctile 8w</th></tr>';
    // Sort by extreme first
    const sorted = markets.slice().sort((a, b) => {
      const aE = a.signal?.extreme ? 1 : 0;
      const bE = b.signal?.extreme ? 1 : 0;
      return bE - aE;
    });
    sorted.forEach(m => {
      const s = m.signal;
      if (!s) return;
      const biasCol = s.bias.includes('CROWDED LONG') ? 'red' : s.bias.includes('CROWDED SHORT') ? 'green' : s.bias.includes('NET LONG') ? 'cyan' : s.bias.includes('NET SHORT') ? 'yellow' : 'muted';
      const wkCol = s.week_change > 0 ? 'green' : s.week_change < 0 ? 'red' : 'muted';
      const pctCol = s.percentile_8w > 90 ? 'red' : s.percentile_8w < 10 ? 'green' : 'muted';
      const flag = s.extreme ? ' 🚨' : '';
      html += '<tr><td><strong>'+m.label+'</strong></td>'
        + '<td class="'+biasCol+'">'+s.bias+flag+'</td>'
        + '<td>'+s.pct_long+'%</td>'
        + '<td class="'+wkCol+'">'+(s.week_change>=0?'+':'')+(s.week_change||0).toLocaleString()+'</td>'
        + '<td class="'+pctCol+'">'+s.percentile_8w+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">COT error</p>'; }
}

// ── ON-CHAIN BTC ──
async function renderOnchain() {
  const el = document.getElementById('onchainPanel');
  if (!el) return;
  try {
    const o = await fetch('/api/onchain-btc').then(r => r.json());
    if (!o.block_height) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node onchain-btc.js</code></p>';
      return;
    }
    let html = '';
    html += '<div class="stat"><span class="label">Block Height</span><span class="value amber">'+o.block_height.toLocaleString()+'</span></div>';
    html += '<div class="stat"><span class="label">Hashrate</span><span class="value green">'+o.hashrate_ehs+' EH/s</span></div>';
    if (o.hashrate_trend_pct_3d !== undefined) {
      const tCol = o.hashrate_trend_pct_3d > 0 ? 'green' : o.hashrate_trend_pct_3d < 0 ? 'red' : 'muted';
      html += '<div class="stat"><span class="label">Trend 3d</span><span class="value '+tCol+'">'+(o.hashrate_trend_pct_3d>=0?'+':'')+o.hashrate_trend_pct_3d+'%</span></div>';
    }
    if (o.fees) {
      const fCol = o.fee_state === 'CONGESTED' ? 'red' : o.fee_state === 'BUSY' ? 'orange' : o.fee_state === 'NORMAL' ? 'yellow' : 'green';
      html += '<div class="stat"><span class="label">Fees (state)</span><span class="value '+fCol+'">'+o.fee_state+'</span></div>';
      html += '<div class="stat" style="font-size:9px;"><span class="label">Fast/Hour/Eco</span><span class="value muted">'+o.fees.fastest_sat_vb+'/'+o.fees.hour_sat_vb+'/'+o.fees.economy_sat_vb+' sat/vB</span></div>';
    }
    if (o.halving) {
      const h = o.halving;
      const hCol = h.daysToNext < 365 ? 'amber' : 'muted';
      html += '<div class="stat"><span class="label">Next Halving</span><span class="value '+hCol+'">'+h.daysToNext+'d</span></div>';
      html += '<div class="stat" style="font-size:9px;"><span class="label">Block reward</span><span class="value muted">'+h.currentSubsidy+' BTC</span></div>';
      html += '<div class="stat" style="font-size:9px;"><span class="label">Blocks to halving</span><span class="value muted">'+h.blocksToNext.toLocaleString()+'</span></div>';
    }
    if (o.total_btc) {
      html += '<div class="stat" style="font-size:9px;"><span class="label">BTC Supply</span><span class="value muted">'+o.total_btc.toLocaleString()+' / 21M</span></div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">On-chain error</p>'; }
}

// ── EARNINGS CALENDAR ──
async function renderEarnings() {
  const el = document.getElementById('earningsPanel');
  if (!el) return;
  try {
    const e = await fetch('/api/earnings').then(r => r.json());
    const events = e.events || [];
    if (events.length === 0) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node earnings-cal.js</code></p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:3px;">'+events.length+' events · '+e.mag7.length+' Mag-7</div>';
    html += '<table style="font-size:10px;"><tr><th>Date</th><th>Time</th><th>Symbol</th><th>EPS Fcst</th><th>vs LY</th></tr>';
    events.slice(0, 20).forEach(ev => {
      const t = ev.time?.includes('pre-market') ? 'PRE' : ev.time?.includes('after-hours') ? 'POST' : '—';
      const tCol = t === 'PRE' ? 'cyan' : t === 'POST' ? 'orange' : 'muted';
      const symCol = ev.is_mag7 ? 'amber' : 'cyan';
      const ly = ev.last_year_eps;
      const fcst = ev.eps_forecast;
      html += '<tr><td class="muted">'+ev.date.substring(5)+'</td>'
        + '<td class="'+tCol+'" style="font-size:9px;">'+t+'</td>'
        + '<td class="'+symCol+'"><strong>'+ev.symbol+'</strong>'+(ev.is_mag7?' 🔥':'')+'</td>'
        + '<td>'+fcst+'</td>'
        + '<td class="muted" style="font-size:9px;">'+(ly||'—')+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(err) { el.innerHTML = '<p class="muted">Earnings error</p>'; }
}

// ── SETUP PERFORMANCE TRACKER ──
async function renderSetupTracker() {
  const el = document.getElementById('setupTracker');
  if (!el) return;
  try {
    const stats = await fetch('/api/setup-stats').then(r => r.json());
    if (stats.total_closed === undefined && stats.note) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node setup-tracker.js --daemon</code></p>';
      return;
    }
    if (stats.total_closed === 0 && stats.total_open === 0) {
      el.innerHTML = '<p class="muted">Tracker actif, aucun setup encore. Le tracker logue auto chaque setup quand le scanner en genere.</p>';
      return;
    }
    let html = '';
    html += '<div class="stat"><span class="label">Open Signals</span><span class="value amber">'+stats.total_open+'</span></div>';
    html += '<div class="stat"><span class="label">Closed</span><span class="value">'+stats.total_closed+'</span></div>';
    const wrCol = stats.win_rate >= 55 ? 'green' : stats.win_rate >= 45 ? 'yellow' : 'red';
    html += '<div class="stat"><span class="label">Win Rate</span><span class="value '+wrCol+'">'+stats.win_rate+'%</span></div>';
    const rCol = stats.total_r >= 0 ? 'green' : 'red';
    html += '<div class="stat"><span class="label">Total R</span><span class="value '+rCol+'">'+(stats.total_r>=0?'+':'')+stats.total_r+'R</span></div>';
    html += '<div class="stat"><span class="label">Avg R/trade</span><span class="value '+(stats.avg_r_per_trade>=0?'green':'red')+'">'+(stats.avg_r_per_trade>=0?'+':'')+stats.avg_r_per_trade+'R</span></div>';

    if (stats.by_quality && Object.keys(stats.by_quality).length > 0) {
      html += '<div class="amber" style="font-size:9px;margin-top:5px;">PAR QUALITE</div>';
      html += '<table style="font-size:10px;"><tr><th>Q</th><th>N</th><th>WR</th><th>Total R</th></tr>';
      Object.keys(stats.by_quality).forEach(q => {
        const d = stats.by_quality[q];
        const c = d.win_rate >= 55 ? 'green' : d.win_rate >= 45 ? 'yellow' : 'red';
        html += '<tr><td><strong>'+q+'</strong></td><td>'+d.total+'</td><td class="'+c+'">'+d.win_rate+'%</td><td class="'+(d.total_r>=0?'green':'red')+'">'+(d.total_r>=0?'+':'')+d.total_r+'R</td></tr>';
      });
      html += '</table>';
    }
    if (stats.by_symbol && Object.keys(stats.by_symbol).length > 0) {
      html += '<div class="amber" style="font-size:9px;margin-top:5px;">PAR SYMBOLE</div>';
      html += '<table style="font-size:10px;"><tr><th>Sym</th><th>N</th><th>WR</th><th>Total R</th></tr>';
      Object.keys(stats.by_symbol).slice(0, 8).forEach(s => {
        const d = stats.by_symbol[s];
        const c = d.win_rate >= 55 ? 'green' : d.win_rate >= 45 ? 'yellow' : 'red';
        html += '<tr><td><strong>'+s+'</strong></td><td>'+d.total+'</td><td class="'+c+'">'+d.win_rate+'%</td><td class="'+(d.total_r>=0?'green':'red')+'">'+(d.total_r>=0?'+':'')+d.total_r+'R</td></tr>';
      });
      html += '</table>';
    }
    if (stats.long || stats.short) {
      html += '<div class="amber" style="font-size:9px;margin-top:5px;">PAR DIRECTION</div>';
      const lc = (stats.long?.win_rate||0) >= 55 ? 'green' : 'yellow';
      const sc = (stats.short?.win_rate||0) >= 55 ? 'green' : 'yellow';
      html += '<div class="stat"><span class="label">LONG</span><span class="value"><span class="'+lc+'">'+(stats.long?.win_rate||0)+'%</span> · '+(stats.long?.total||0)+' trades</span></div>';
      html += '<div class="stat"><span class="label">SHORT</span><span class="value"><span class="'+sc+'">'+(stats.short?.win_rate||0)+'%</span> · '+(stats.short?.total||0)+' trades</span></div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Tracker error</p>'; }
}

// ── SENTIMENT TREND (24h trajectory chart) ──
async function renderSentimentTrend() {
  const canvas = document.getElementById('sentimentChart');
  const legend = document.getElementById('sentimentLegend');
  if (!canvas || !canvas.getContext) return;
  try {
    const h = await fetch('/api/sentiment-history').then(r => r.json());
    const snaps = h.snapshots || [];
    if (snaps.length < 2) {
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      ctx.fillStyle = '#616161'; ctx.font = '11px monospace';
      ctx.fillText('Need 2+ snapshots (trade-agent runs every 15min)', 10, 50);
      if (legend) legend.textContent = snaps.length + ' snapshot(s) collected';
      return;
    }
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    const w = canvas.width, ht = canvas.height;
    ctx.clearRect(0, 0, w, ht);

    // Y axis: 0-100 (riskIndex), but VIX/F&G are different scales
    // Plot riskIndex on primary axis (0-100), VIX scaled (multiply by 4 to occupy similar range), F&G already 0-100
    const padX = 14, padY = 10;

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(yv => {
      const y = ht - padY - (yv / 100) * (ht - 2 * padY);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(w - padX, y);
      ctx.stroke();
    });
    // 50-line (neutral)
    ctx.strokeStyle = '#444';
    ctx.setLineDash([3, 3]);
    const y50 = ht - padY - 0.5 * (ht - 2 * padY);
    ctx.beginPath(); ctx.moveTo(padX, y50); ctx.lineTo(w - padX, y50); ctx.stroke();
    ctx.setLineDash([]);

    // Plot helper
    const xAt = (i) => padX + (i / (snaps.length - 1)) * (w - 2 * padX);
    const yAtPct = (v) => ht - padY - (Math.max(0, Math.min(100, v)) / 100) * (ht - 2 * padY);

    const plot = (key, color, scaleFn) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      snaps.forEach((s, i) => {
        const v = s[key];
        if (v === null || v === undefined) return;
        const x = xAt(i);
        const y = yAtPct(scaleFn ? scaleFn(v) : v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    // Risk Index (yellow, primary)
    plot('risk', '#FFB800', null);
    // F&G (cyan)
    plot('fg', '#00BCD4', null);
    // VIX scaled (×3, capped 100): red
    plot('vix', '#FF5252', v => v * 3);
    // Gold sentiment (green) — scale -2..2 → 0..100
    plot('gold_sent', '#00E676', v => 50 + v * 25);
    // Oil sentiment (orange)
    plot('oil_sent', '#FF9800', v => 50 + v * 25);

    if (legend) {
      const last = snaps[snaps.length - 1];
      const first = snaps[0];
      const dRisk = (last.risk - first.risk).toFixed(0);
      const dCol = dRisk > 0 ? 'green' : dRisk < 0 ? 'red' : 'muted';
      legend.innerHTML =
        '<span style="color:#FFB800;">━ Risk '+last.risk+'</span> · ' +
        '<span style="color:#00BCD4;">━ F&G '+(last.fg||'—')+'</span> · ' +
        '<span style="color:#FF5252;">━ VIX×3 '+(last.vix||'—')+'</span> · ' +
        '<span style="color:#00E676;">━ Gold</span> · ' +
        '<span style="color:#FF9800;">━ Oil</span> · ' +
        snaps.length + ' snaps · ' +
        '<span class="'+dCol+'">Δ'+(dRisk>=0?'+':'')+dRisk+' risk</span>';
    }
  } catch(e) {}
}

// ── COMPOSITE RISK INDEX (big-number gauge) ──
async function renderRiskIndex() {
  const el = document.getElementById('riskIndex');
  if (!el) return;
  try {
    const b = await fetch('/api/trade-brief').then(r => r.json());
    const r = b.risk_index;
    if (!r) { el.innerHTML = '<p class="muted" style="font-size:9px;">No data</p>'; return; }
    const score = r.score;
    const col = r.color === 'red' ? '#FF3838' : r.color === 'orange' ? '#FF9800' : r.color === 'yellow' ? '#FFEB3B' : r.color === 'green' ? '#00E676' : r.color === 'amber' ? '#FFB800' : '#888';
    // Semi-circle gauge
    const angle = Math.PI * (1 - score / 100);
    const cx = 50, cy = 50, R = 38;
    const x = cx + R * Math.cos(angle);
    const y = cy - R * Math.sin(angle);
    let html = '<svg viewBox="0 0 100 60" style="width:100%;max-width:140px;">';
    html += '<path d="M12 50 A 38 38 0 0 1 88 50" fill="none" stroke="#222" stroke-width="6"/>';
    html += '<path d="M12 50 A 38 38 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="6" stroke-linecap="round"/>';
    html += '<text x="50" y="44" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold" fill="' + col + '">' + score + '</text>';
    html += '</svg>';
    html += '<div style="font-size:11px;font-weight:bold;color:' + col + ';letter-spacing:1px;margin-top:-4px;">' + r.label + '</div>';
    // Top 3 contributing components
    const top = (r.components || []).slice().sort((a,b) => Math.abs(parseFloat(b.contrib)||0) - Math.abs(parseFloat(a.contrib)||0)).slice(0, 4);
    html += '<div style="font-size:9px;color:var(--muted);margin-top:5px;line-height:1.4;text-align:left;">';
    top.forEach(c => {
      const cc = c.contrib.startsWith('+') ? 'green' : c.contrib.startsWith('-') ? 'red' : 'muted';
      html += '<div><span class="amber">'+c.k+'</span> '+c.v+' <span class="'+cc+'">'+c.contrib.split(' ')[0]+'</span></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted" style="font-size:9px;">Risk index error</p>'; }
}

// ── MAG-7 PANEL ──
async function renderMag7() {
  const el = document.getElementById('mag7Panel');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const d = m.data || {};
    const stocks = [
      { k:'aapl', l:'AAPL', n:'Apple' },
      { k:'msft', l:'MSFT', n:'Microsoft' },
      { k:'googl', l:'GOOGL', n:'Alphabet' },
      { k:'amzn', l:'AMZN', n:'Amazon' },
      { k:'nvda', l:'NVDA', n:'Nvidia' },
      { k:'meta', l:'META', n:'Meta' },
      { k:'tsla', l:'TSLA', n:'Tesla' }
    ];
    const items = stocks.filter(s => d[s.k]);
    if (items.length === 0) {
      el.innerHTML = '<p class="muted">Pas de data Mag-7</p>';
      return;
    }
    const total = items.reduce((a,s) => a + (d[s.k]?.changePct || 0), 0);
    const avg = total / items.length;
    let html = '<div class="stat"><span class="label">Avg Δ</span><span class="value '+(avg>0?'green':avg<0?'red':'muted')+'">'+(avg>=0?'+':'')+avg.toFixed(2)+'%</span></div>';
    html += '<table style="font-size:10px;"><tr><th>Sym</th><th>Px</th><th>Δ%</th></tr>';
    items.sort((a,b) => (d[b.k]?.changePct||0) - (d[a.k]?.changePct||0));
    items.forEach(s => {
      const x = d[s.k];
      const col = x.changePct > 0 ? 'green' : x.changePct < 0 ? 'red' : 'muted';
      const arrow = x.changePct > 0 ? '▲' : x.changePct < 0 ? '▼' : '·';
      html += '<tr><td><strong>'+s.l+'</strong></td><td class="amber">'+x.price+'</td><td class="'+col+'">'+arrow+(x.changePct>=0?'+':'')+x.changePct.toFixed(2)+'%</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Mag-7 error</p>'; }
}

// ── PER-SYMBOL PLAYBOOK NOTES (localStorage) ──
function getPlaybook(sym) {
  try { return localStorage.getItem('pb_' + sym) || ''; } catch { return ''; }
}
function setPlaybook(sym, text) {
  if (text) localStorage.setItem('pb_' + sym, text);
  else localStorage.removeItem('pb_' + sym);
}
function savePlaybook(sym) {
  const ta = document.getElementById('pbInput');
  setPlaybook(sym, ta.value);
  const status = document.getElementById('pbStatus');
  if (status) { status.textContent = '✅ Saved'; setTimeout(() => status.textContent = '', 1500); }
}

// ── MARKET WRAP (verbal narrative summary) ──
async function renderMarketWrap() {
  const el = document.getElementById('marketWrap');
  if (!el) return;
  try {
    const [b, m, c, sc] = await Promise.all([
      fetch('/api/trade-brief').then(r => r.json()),
      fetch('/api/macro-pulse').then(r => r.json()),
      fetch('/api/crypto-pulse').then(r => r.json()),
      fetch('/api/scan').then(r => r.json())
    ]);
    if (!b.regime) { el.innerHTML = '<p class="muted">Pas de brief — lance trade-agent.js</p>'; return; }
    const rCol = b.regime.verdict === 'RISK-ON' ? 'green' : b.regime.verdict === 'RISK-OFF' ? 'red' : 'yellow';
    const session = b.snapshot?.session || '—';
    const dxy = m.data?.dxy?.price;
    const vix = m.data?.vix?.price;
    const us10y = m.data?.us10y?.price;
    const fg = c.fear_greed?.current;
    const fgClass = c.fear_greed?.classification;
    const dxyChg = m.data?.dxy?.changePct;
    const goldFut = m.data?.gold_f;
    const oilFut = m.data?.oil_f;
    const sectorVerdict = m.sector_rotation?.risk_on_score > m.sector_rotation?.risk_off_score ? 'risk-on' : 'risk-off';

    // Compose narrative
    let parts = [];
    parts.push('<span class="amber" style="font-weight:bold;">SESSION ' + session + '</span> — Markets in <span class="' + rCol + '" style="font-weight:bold;">' + b.regime.verdict + '</span> regime (confidence ' + b.regime.confidence + ').');

    if (vix !== undefined) {
      const vState = vix < 15 ? 'complacent' : vix < 20 ? 'normal' : vix < 25 ? 'elevated' : 'stressed';
      parts.push('VIX <strong>' + vix + '</strong> (' + vState + ')' + (m.regime?.vix_term_state==='CONTANGO_DEEP' ? ' with deep contango — institutionals not pricing fear' : m.regime?.vix_term_state==='BACKWARDATION' ? ' in backwardation — front-month panic' : '') + '.');
    }
    if (dxy !== undefined) {
      const dxyDir = dxyChg > 0.1 ? 'firming' : dxyChg < -0.1 ? 'softening' : 'flat';
      parts.push('DXY ' + dxy + ' ' + dxyDir + ' (' + (dxyChg>=0?'+':'') + (dxyChg||0).toFixed(2) + '%)' + (us10y ? ', US 10Y at ' + us10y + '%' : '') + '.');
    }
    if (goldFut) {
      const goldDir = goldFut.changePct > 0.3 ? 'bid' : goldFut.changePct < -0.3 ? 'offered' : 'ranging';
      parts.push('Gold <strong>' + goldFut.price + '</strong> ' + goldDir + (oilFut ? ', WTI ' + oilFut.price + ' (' + (oilFut.changePct>=0?'+':'') + (oilFut.changePct||0).toFixed(2) + '%)' : '') + '.');
    }
    if (fg !== undefined) {
      parts.push('Crypto F&G <strong>' + fg + '</strong> (' + fgClass + ')' + (b.snapshot?.btc_dom ? ', BTC dominance ' + b.snapshot.btc_dom + '%' : '') + '.');
    }
    if (sectorVerdict) {
      const lead = m.sector_rotation?.leaders?.[0];
      const lag = m.sector_rotation?.laggards?.[0];
      if (lead && lag) parts.push('Sectors lean <strong>' + sectorVerdict + '</strong> — ' + lead.label.split(' ')[0] + ' leads (+' + lead.chg.toFixed(2) + '%), ' + lag.label.split(' ')[0] + ' lags (' + lag.chg.toFixed(2) + '%).');
    }

    // Top idea
    const top = b.ideas?.[0];
    if (top) parts.push('<span class="cyan">Top setup:</span> <strong>' + top.grade + ' ' + top.direction + ' ' + tvLink(top.symbol) + '</strong> (score ' + top.synthesis_score + ')' + (top.entry?(' entry '+top.entry):'') + '.');

    // Cot extremes
    const cotExtremes = b.snapshot?.cot_extremes || [];
    if (cotExtremes.length > 0) {
      const top3 = cotExtremes.slice(0, 3).map(c => c.asset + ' ' + c.bias.toLowerCase()).join(', ');
      parts.push('<span class="orange">COT extremes:</span> ' + top3 + '.');
    }

    // News triggers
    const trigs = b.snapshot?.news_triggers;
    if (trigs > 0) parts.push('<span class="orange">' + trigs + ' active news triggers</span> in feed.');

    // Divergences
    if (b.divergences?.length > 0) {
      parts.push('<span class="orange">⚠ ' + b.divergences.length + ' divergence(s):</span> ' + b.divergences.slice(0, 2).map(d => d.kind + ' on ' + d.asset).join(', ') + '.');
    }

    // Catalysts upcoming
    const cat = b.catalysts?.econ?.[0];
    if (cat) {
      const dt = new Date(cat.datetime);
      const ms = dt - new Date();
      const h = Math.floor(ms / 3600000);
      if (ms > 0 && h < 48) parts.push('<span class="amber">Next catalyst T-' + (h<24?h+'h':Math.floor(h/24)+'d')+ ':</span> ' + cat.name + '.');
    }

    el.innerHTML = parts.join(' ');
  } catch(e) { el.innerHTML = '<p class="muted">Wrap unavailable</p>'; }
}

// ── BOTTOM NEWS HEADLINES TICKER ──
async function renderNewsTickerBottom() {
  const el = document.getElementById('newsTickerTrack');
  if (!el || !LAST_NEWS?.items) return;
  // Top priority: triggers + HIGH category items
  const top = LAST_NEWS.items
    .filter(i => i.priority === 'HIGH' || (i.triggers && i.triggers.length > 0))
    .slice(0, 30);
  const buildItem = (i) => {
    const isTrig = i.triggers?.length > 0;
    const cls = isTrig ? 'crit' : '';
    const cat = '<span class="cat">[' + i.category + ']</span>';
    return '<span class="news-ticker-item ' + cls + '">' + cat + ' ' + i.title.substring(0, 130) + '</span>';
  };
  // Duplicate for seamless loop
  el.innerHTML = top.map(buildItem).join('') + top.map(buildItem).join('');
}

// ── WATCHLIST (localStorage starred symbols) ──
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('watchlist') || '[]'); } catch { return []; }
}
function setWatchlist(arr) {
  localStorage.setItem('watchlist', JSON.stringify(arr));
}
function toggleWatchlist(symbol) {
  let wl = getWatchlist();
  if (wl.includes(symbol)) wl = wl.filter(s => s !== symbol);
  else wl.push(symbol);
  setWatchlist(wl);
  renderWatchlist();
  renderHeatmap(window.__LAST_SCAN || { symbols: [] });
}
async function renderWatchlist() {
  const el = document.getElementById('watchlist');
  if (!el) return;
  const wl = getWatchlist();
  document.getElementById('watchlistCount').textContent = wl.length + ' symbol' + (wl.length>1?'s':'');
  if (wl.length === 0) {
    el.innerHTML = '<p class="muted" style="font-size:10px;padding:4px;">Aucun favori. Clic-droit sur un symbole dans la heatmap pour starrer.</p>';
    return;
  }
  const scan = window.__LAST_SCAN || await fetch('/api/scan').then(r => r.json());
  const macro = await fetch('/api/macro-pulse').then(r => r.json()).catch(() => ({ data: {} }));
  let html = '<table style="font-size:10px;"><tr><th>Sym</th><th>Px</th><th>HTF</th><th>Sig</th><th></th></tr>';
  wl.forEach(s => {
    const sym = (scan.symbols || []).find(x => x.symbol === s);
    const tf = sym?.tf_240 || {};
    const htf = tf['HTF (D)'] || tf.HTF || '—';
    const sig = (tf.Signal || 'NONE').split(' ')[0];
    const conv = tf.Conviction || '—';
    const sigCol = sig.includes('LONG') ? 'green' : sig.includes('SHORT') ? 'red' : 'muted';
    const htfCol = isBullish(htf) ? 'green' : isBearish(htf) ? 'red' : '';
    const px = sym?.price ?? (macro.data[s.toLowerCase()]?.price ?? '—');
    html += '<tr><td><strong>'+tvLink(s)+'</strong></td>'
      + '<td>'+px+'</td>'
      + '<td class="'+htfCol+'">'+htf+'</td>'
      + '<td class="'+sigCol+'">'+sig+' '+conv+'</td>'
      + '<td><button onclick="toggleWatchlist(\\''+s+'\\')" style="background:transparent;color:var(--red);border:none;cursor:pointer;padding:0;">✕</button></td></tr>';
  });
  html += '</table>';
  el.innerHTML = html;
}

// ── WEI (World Equity Indices) ──
async function renderWEI() {
  const el = document.getElementById('weiPanel');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const scan = window.__LAST_SCAN || await fetch('/api/scan').then(r => r.json());
    const d = m.data || {};
    // Build a unified table: scan indices + macro futures
    const items = [];
    const findScan = (sym) => (scan.symbols || []).find(s => s.symbol === sym);
    [['SPX500','S&P 500'],['NAS100','NAS 100'],['DAX','DAX'],['CAC40','CAC 40']].forEach(([sym, label]) => {
      const s = findScan(sym);
      if (s) {
        const htf = s.tf_240?.['HTF (D)'] || s.tf_240?.HTF || '';
        items.push({ label, price: s.price, bias: htf, source: 'scan', sym });
      }
    });
    // Add futures from macro-pulse
    if (d.spx) items.push({ label: 'S&P 500 (Yahoo)', price: d.spx.price, chgPct: d.spx.changePct, source: 'macro' });
    if (d.gold_f) items.push({ label: 'Gold Futures', price: d.gold_f.price, chgPct: d.gold_f.changePct, source: 'macro' });
    if (d.silver_f) items.push({ label: 'Silver Futures', price: d.silver_f.price, chgPct: d.silver_f.changePct, source: 'macro' });
    if (d.oil_f) items.push({ label: 'WTI Futures', price: d.oil_f.price, chgPct: d.oil_f.changePct, source: 'macro' });
    if (d.brent_f) items.push({ label: 'Brent Futures', price: d.brent_f.price, chgPct: d.brent_f.changePct, source: 'macro' });
    if (d.copper_f) items.push({ label: 'Copper Fut', price: d.copper_f.price, chgPct: d.copper_f.changePct, source: 'macro' });

    let html = '<table style="font-size:10px;"><tr><th>Index</th><th>Last</th><th>Δ%/HTF</th></tr>';
    items.forEach(i => {
      let val = '—', col = 'muted';
      if (i.chgPct !== undefined) {
        col = i.chgPct > 0 ? 'green' : i.chgPct < 0 ? 'red' : 'muted';
        const arrow = i.chgPct > 0 ? '▲' : i.chgPct < 0 ? '▼' : '·';
        val = arrow + ' ' + (i.chgPct >= 0 ? '+' : '') + i.chgPct.toFixed(2) + '%';
      } else if (i.bias) {
        val = i.bias;
        col = isBullish(i.bias) ? 'green' : isBearish(i.bias) ? 'red' : 'muted';
      }
      const tvLabel = i.sym ? tvLink(i.sym, i.label) : i.label;
      html += '<tr><td><strong>'+tvLabel+'</strong></td><td class="amber">'+i.price+'</td><td class="'+col+'">'+val+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">WEI error</p>'; }
}

// ── AGENT BRIEF (multi-source synthesis) ──
async function renderAgentBrief() {
  const el = document.getElementById('agentBrief');
  if (!el) return;
  try {
    const b = await fetch('/api/trade-brief').then(r => r.json());
    if (!b.regime) {
      el.innerHTML = '<p class="muted">Pas de brief. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node trade-agent.js</code></p>';
      return;
    }
    const rCol = b.regime.verdict === 'RISK-ON' ? 'green' : b.regime.verdict === 'RISK-OFF' ? 'red' : 'yellow';
    const age = (Date.now() - new Date(b.timestamp).getTime()) / 60000;
    const ageStr = age < 1 ? 'just now' : age < 60 ? Math.floor(age) + 'm ago' : Math.floor(age/60) + 'h ago';

    let html = '<div style="display:grid;grid-template-columns:2fr 3fr 3fr 2fr;gap:10px;font-size:11px;">';

    // Col 1: Regime + snapshot
    html += '<div>';
    html += '<div style="font-size:9px;color:var(--muted);">REGIME · '+ageStr+'</div>';
    html += '<div class="'+rCol+'" style="font-size:18px;font-weight:bold;">'+b.regime.verdict+'</div>';
    html += '<div class="muted" style="font-size:9px;">Conf '+b.regime.confidence+' · '+b.regime.on_score+' on / '+b.regime.off_score+' off</div>';
    if (b.snapshot) {
      const snap = b.snapshot;
      html += '<div style="margin-top:5px;border-top:1px dotted var(--border);padding-top:4px;font-size:10px;">';
      if (snap.vix !== undefined) html += '<div>VIX <span class="amber">'+snap.vix+'</span></div>';
      if (snap.dxy !== undefined) html += '<div>DXY <span class="amber">'+snap.dxy+'</span></div>';
      if (snap.us10y !== undefined) html += '<div>US10Y <span class="amber">'+snap.us10y+'%</span></div>';
      if (snap.fear_greed !== undefined) html += '<div>F&G <span class="amber">'+snap.fear_greed+'</span></div>';
      if (snap.btc_dom !== undefined) html += '<div>BTC dom <span class="amber">'+snap.btc_dom+'%</span></div>';
      if (snap.session) html += '<div>Sess <span class="amber">'+snap.session+'</span></div>';
      html += '</div>';
    }
    html += '</div>';

    // Col 2: Top ideas (top 4)
    html += '<div>';
    html += '<div style="font-size:9px;color:var(--muted);">TOP IDEAS</div>';
    if (b.ideas && b.ideas.length > 0) {
      b.ideas.slice(0, 4).forEach(i => {
        const dCol = i.direction === 'LONG' ? 'green' : 'red';
        const gCol = i.grade === 'A+' ? 'green' : i.grade === 'A' ? 'green' : i.grade === 'B' ? 'yellow' : 'orange';
        html += '<div style="font-size:10px;margin-bottom:3px;border-left:2px solid var(--'+dCol+');padding:2px 6px;">';
        html += '<span class="'+gCol+'" style="font-weight:bold;">'+i.grade+'</span> '
          + '<span class="'+dCol+'">'+i.direction+'</span> '
          + '<strong>'+tvLink(i.symbol)+'</strong> '
          + '<span class="muted" style="font-size:8px;">score '+i.synthesis_score+(i.entry?(' · '+i.entry):'')+'</span>';
        if (i.flags && i.flags.length > 0) {
          html += '<div class="orange" style="font-size:9px;">⚠ '+i.flags[0]+'</div>';
        } else if (i.reasons && i.reasons.length > 0) {
          html += '<div class="muted" style="font-size:9px;">'+i.reasons[0].substring(0, 70)+'</div>';
        }
        html += '</div>';
      });
    } else {
      html += '<p class="muted" style="font-size:10px;">No ideas — wait for setup or run scanner</p>';
    }
    html += '</div>';

    // Col 3: Divergences + Action items
    html += '<div>';
    html += '<div style="font-size:9px;color:var(--muted);">ACTION ITEMS</div>';
    (b.action_items || []).forEach(a => {
      html += '<div style="font-size:10px;margin-bottom:2px;">'+a+'</div>';
    });
    if (b.divergences && b.divergences.length > 0) {
      html += '<div style="font-size:9px;color:var(--muted);margin-top:5px;">DIVERGENCES</div>';
      b.divergences.slice(0, 4).forEach(d => {
        html += '<div style="font-size:9px;margin-bottom:2px;color:var(--orange);">⚠ '+d.kind+' '+d.asset+'</div>';
        html += '<div style="font-size:9px;color:var(--muted);margin-left:14px;">'+d.detail.substring(0, 110)+'</div>';
      });
    }
    html += '</div>';

    // Col 4: Upcoming catalysts
    html += '<div>';
    html += '<div style="font-size:9px;color:var(--muted);">UPCOMING (7d)</div>';
    const cats = b.catalysts || { econ: [], earnings: [] };
    cats.econ.slice(0, 3).forEach(e => {
      const dt = new Date(e.datetime);
      const day = dt.toUTCString().substring(0, 11);
      const col = e.impact === 'HIGH' ? 'red' : 'yellow';
      html += '<div style="font-size:9px;margin-bottom:2px;"><span class="'+col+'">●</span> '+day+' '+e.name.substring(0,28)+'</div>';
    });
    if (cats.earnings.length > 0) {
      html += '<div style="font-size:9px;color:var(--muted);margin-top:4px;">EARNINGS</div>';
      cats.earnings.slice(0, 4).forEach(e => {
        html += '<div style="font-size:9px;"><span class="amber">'+e.symbol+'</span>'+(e.is_mag7?' 🔥':'')+' '+e.date.substring(5)+'</div>';
      });
    }
    html += '</div>';

    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Agent brief error</p>'; }
}

// ── CURRENCY STRENGTH ──
async function renderCurrencyStrength() {
  const el = document.getElementById('currencyStrength');
  if (!el) return;
  try {
    const c = await fetch('/api/currency-strength').then(r => r.json());
    if (!c.ranking) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node currency-strength.js</code></p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:3px;">Base: scan TF_240 HTF + DXY overlay</div>';
    html += '<table style="font-size:11px;"><tr><th>Currency</th><th>Strength</th><th>Bar</th></tr>';
    c.ranking.forEach(r => {
      const col = r.strength > 0.5 ? 'green' : r.strength < -0.5 ? 'red' : 'yellow';
      const w = Math.abs(r.strength) * 50;  // up to 50px each side
      const bar = r.strength >= 0
        ? '<span style="display:inline-block;width:'+w+'px;height:8px;background:var(--green);margin-left:50px;"></span>'
        : '<span style="display:inline-block;width:'+w+'px;height:8px;background:var(--red);margin-left:'+(50-w)+'px;"></span>';
      html += '<tr><td><strong>'+r.currency+'</strong></td><td class="'+col+'">'+(r.strength>=0?'+':'')+r.strength+'</td><td style="width:110px;">'+bar+'</td></tr>';
    });
    html += '</table>';
    if (c.best_pair) {
      const dirCol = c.best_pair.direction === 'LONG' ? 'green' : 'red';
      html += '<div style="border-top:1px dotted var(--border);margin-top:6px;padding-top:5px;">';
      html += '<div class="amber" style="font-size:9px;">BEST FX TRADE</div>';
      html += '<div style="font-size:13px;"><strong>'+tvLink(c.best_pair.pair)+'</strong> <span class="badge badge-'+(c.best_pair.direction==='LONG'?'long':'short')+'">'+c.best_pair.direction+'</span></div>';
      html += '<div class="muted" style="font-size:9px;margin-top:2px;">'+c.best_pair.rationale+'</div>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Currency strength error</p>'; }
}

// ── VIX TERM STRUCTURE ──
async function renderVixTerm() {
  const el = document.getElementById('vixTerm');
  if (!el) return;
  try {
    const m = await fetch('/api/macro-pulse').then(r => r.json());
    const d = m.data || {};
    if (!d.vix) { el.innerHTML = '<p class="muted">Pas de data VIX</p>'; return; }
    const tenors = [
      { k: 'vix9d', l: '9d' },
      { k: 'vix', l: '30d' },
      { k: 'vix3m', l: '3M' },
      { k: 'vix6m', l: '6M' }
    ];
    let html = '<table style="font-size:11px;"><tr><th>Tenor</th><th>VIX</th><th>Δ</th></tr>';
    tenors.forEach(t => {
      const x = d[t.k]; if (!x) return;
      const col = x.changePct > 0 ? 'red' : x.changePct < 0 ? 'green' : 'muted';
      html += '<tr><td><strong>'+t.l+'</strong></td><td class="amber">'+x.price+'</td><td class="'+col+'">'+(x.changePct>=0?'+':'')+x.changePct.toFixed(2)+'%</td></tr>';
    });
    html += '</table>';
    if (m.regime?.vix_term_state) {
      const ts = m.regime.vix_term_structure;
      const state = m.regime.vix_term_state;
      const col = state === 'BACKWARDATION' ? 'red' : state === 'CONTANGO_DEEP' ? 'green' : 'yellow';
      const interp = state === 'BACKWARDATION' ? '🚨 STRESS — front-month panic' :
                     state === 'CONTANGO_DEEP' ? 'CALM — fear priced lower' : 'NORMAL';
      html += '<div class="stat" style="margin-top:5px;border-top:1px dotted var(--border);padding-top:5px;"><span class="label">Term</span><span class="value '+col+'">'+state+' '+(ts>=0?'+':'')+ts.toFixed(2)+'</span></div>';
      html += '<div class="muted" style="font-size:9px;font-style:italic;">'+interp+'</div>';
    }
    if (m.regime?.vix_short_ratio) {
      const r = m.regime.vix_short_ratio;
      const col = r > 1 ? 'red' : 'muted';
      html += '<div class="stat"><span class="label">9d/VIX ratio</span><span class="value '+col+'">'+r+'</span></div>';
    }
    if (m.regime?.credit_ratio_hyg_ief !== undefined) {
      html += '<div class="stat" style="margin-top:5px;border-top:1px dotted var(--border);padding-top:5px;"><span class="label">HYG/IEF</span><span class="value amber">'+m.regime.credit_ratio_hyg_ief+'</span></div>';
      html += '<div class="muted" style="font-size:9px;">junk/safe ratio — falling = credit stress</div>';
    }
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">VIX term error</p>'; }
}

// ── REDDIT MANIA ──
async function renderRedditMania() {
  const el = document.getElementById('redditMania');
  if (!el) return;
  try {
    const r = await fetch('/api/reddit-mania').then(res => res.json());
    if (!r.top_tickers || r.top_tickers.length === 0) {
      el.innerHTML = '<p class="muted">Pas de data. Lance: <code style="background:#222;padding:1px 3px;font-size:9px;">node reddit-mania.js</code></p>';
      return;
    }
    const lvl = r.mania_level || 'CALM';
    const lvlCol = lvl === 'EXTREME' ? 'red' : lvl === 'ELEVATED' ? 'orange' : lvl === 'NORMAL' ? 'yellow' : 'green';
    let html = '<div class="stat"><span class="label">Mania Level</span><span class="value '+lvlCol+'">'+lvl+'</span></div>';
    html += '<div class="stat" style="font-size:9px;"><span class="label">Posts/Mentions</span><span class="value muted">'+(r.posts_scanned||0)+' / '+(r.total_mentions||0)+'</span></div>';
    html += '<table style="font-size:10px;margin-top:4px;"><tr><th>Ticker</th><th>N</th><th>Δ vs prev</th><th>Spike</th></tr>';
    r.top_tickers.slice(0, 12).forEach(t => {
      const dCol = t.delta > 0 ? 'green' : t.delta < 0 ? 'red' : 'muted';
      const spikeCol = t.spike_factor >= 3 ? 'red' : t.spike_factor >= 2 ? 'orange' : 'muted';
      const spikeFmt = t.spike_factor === 99 ? 'NEW' : t.spike_factor + 'x';
      html += '<tr><td><strong>'+t.ticker+'</strong></td>'
        + '<td>'+t.mentions+'</td>'
        + '<td class="'+dCol+'">'+(t.delta>=0?'+':'')+t.delta+'</td>'
        + '<td class="'+spikeCol+'">'+spikeFmt+'</td></tr>';
    });
    html += '</table>';
    html += '<div class="muted" style="font-size:9px;font-style:italic;margin-top:3px;">Spike fort = retail attention crowded → contrarian risk</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Reddit error</p>'; }
}

// ── SETUP A+ ALERT BANNER ──
async function renderSetupAlertBanner() {
  const bar = document.getElementById('setupAlertBar');
  if (!bar) return;
  try {
    const p = await fetch('/api/pending-alerts').then(r => r.json());
    const alerts = p.alerts || [];
    if (alerts.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const a = alerts[0];
    const rest = alerts.length > 1 ? ' · +' + (alerts.length - 1) + ' autres' : '';
    bar.innerHTML = '🚨 <span style="font-weight:900;">' + a.message + '</span>'
      + rest
      + ' <button onclick="dismissAlerts()" style="background:#000;color:#fff;border:1px solid #333;padding:2px 8px;font-size:10px;border-radius:2px;cursor:pointer;font-family:inherit;margin-left:8px;">DISMISS</button>';
  } catch(e) {}
}
async function dismissAlerts() {
  await fetch('/api/dismiss-alerts', { method: 'POST' });
  document.getElementById('setupAlertBar').style.display = 'none';
}

// ── CATALYST COUNTDOWN (next HIGH-impact event sticky bar) ──
let CATALYST_TIMER = null;
async function renderCatalyst() {
  try {
    const cal = await fetch('/api/calendar').then(r => r.json());
    const now = new Date();
    const upcoming = (cal.events || [])
      .filter(e => new Date(e.datetime) > now && e.impact === 'HIGH')
      .sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
    const bar = document.getElementById('catalystBar');
    if (!bar) return;
    if (upcoming.length === 0) { bar.style.display = 'none'; return; }
    const next = upcoming[0];
    const updateCountdown = () => {
      const dt = new Date(next.datetime);
      const ms = dt - new Date();
      if (ms <= 0) { bar.style.display = 'none'; return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const t = h > 0 ? h+'h '+String(m).padStart(2,'0')+'m' : m+'m '+String(s).padStart(2,'0')+'s';
      const urgent = ms < 3600000; // <1h
      const urgencyCol = urgent ? '#FF3838' : ms < 4*3600000 ? '#FFB800' : '#00BCD4';
      bar.style.borderBottomColor = urgencyCol;
      bar.style.color = urgent ? '#FF3838' : 'var(--text)';
      const animate = urgent ? 'animation:flash 1.2s infinite;' : '';
      bar.style.cssText = 'display:flex;background:#0f0f0f;border-bottom:1px solid '+urgencyCol+';padding:5px 14px;font-size:11px;align-items:center;gap:12px;justify-content:center;'+animate;
      bar.innerHTML = '<span style="color:'+urgencyCol+';font-weight:bold;">⏱ NEXT CATALYST T-' + t + '</span>'
        + '<span style="color:var(--amber);font-weight:bold;">'+next.name+'</span>'
        + '<span class="muted">' + new Date(next.datetime).toUTCString().substring(5, 22) + '</span>'
        + '<span style="color:var(--cyan);">→ '+(next.affects||[]).join(', ')+'</span>';
    };
    if (CATALYST_TIMER) clearInterval(CATALYST_TIMER);
    updateCountdown();
    CATALYST_TIMER = setInterval(updateCountdown, 1000);
  } catch(e) {}
}

// ── LIVE NEWS STREAM (full feed, time-ordered) ──
function renderNewsStream(news) {
  const el = document.getElementById('newsStream');
  if (!el || !news) return;
  const items = (news.items || []).slice().sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
  if (items.length === 0) {
    el.innerHTML = '<p class="muted">No news. Run: <code style="background:#222;padding:1px 3px;">node news-scanner.js</code></p>';
    return;
  }
  const catCol = { GEO:'#FF3838', ENERGY:'#FF9800', METAL:'#FFB800', SHIP:'#00BCD4', AI:'#E040FB', DEFENSE:'#FFEB3B', MACRO:'#00E676', CRYPTO:'#FFB800' };
  let html = '<div class="muted" style="font-size:9px;margin-bottom:4px;">' + items.length + ' items · Last update ' + new Date(news.timestamp).toLocaleTimeString() + '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">';
  items.slice(0, 40).forEach(i => {
    const hasT = i.triggers && i.triggers.length > 0;
    const cc = catCol[i.category] || '#888';
    const bg = hasT ? 'rgba(255,56,56,0.06)' : 'transparent';
    const timeStr = i.pubDate ? new Date(i.pubDate).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
    html += '<div style="border-left:2px solid ' + cc + ';padding:3px 6px;font-size:10px;background:'+bg+';">'
      + '<div style="display:flex;justify-content:space-between;gap:4px;align-items:flex-start;">'
      + '<span style="line-height:1.3;"><span style="color:'+cc+';font-size:8px;font-weight:bold;letter-spacing:1px;">['+i.category+']</span> '
      + i.title.substring(0, 130) + (i.title.length>130?'…':'') + '</span>'
      + '<span class="muted" style="font-size:8px;white-space:nowrap;">'+timeStr+'</span>'
      + '</div>'
      + (hasT ? '<div class="red" style="font-size:8px;margin-top:1px;">🚨 '+i.triggers.join(' · ')+'</div>' : '')
      + '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// ── BEST SETUP NOW ──
async function renderBestSetup() {
  const el = document.getElementById('bestSetup');
  if (!el) return;
  try {
    const data = await fetch('/api/setups').then(r => r.json());
    const setups = data.setups || [];
    if (setups.length === 0) {
      el.innerHTML = '<p class="muted" style="padding:6px;">Aucun setup qualifié maintenant.<br>Régime: '+(data.market_context?.regime||'—')+' · Session: '+(data.market_context?.session||'—')+'</p>';
      return;
    }
    const s = setups[0]; // top setup
    const dCol = s.direction === 'LONG' ? 'green' : 'red';
    const dBadge = s.direction === 'LONG' ? 'badge-long' : 'badge-short';
    const qCol = s.quality === 'A+' || s.quality === 'A' ? 'green' : s.quality === 'B' ? 'yellow' : 'orange';
    let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<div><strong style="font-size:18px;">'+tvLink(s.symbol)+'</strong> '
      + '<span class="badge '+dBadge+'" style="font-size:11px;">'+s.direction+'</span> '
      + '<span class="'+qCol+'" style="font-weight:bold;font-size:13px;">'+s.quality+'</span> '
      + '<span class="muted" style="font-size:10px;">score '+s.score+'</span>';
    html += '</div>';
    html += '<a href="'+tvUrl(s.symbol)+'" target="_blank" class="btn btn-orange btn-sm" style="text-decoration:none;">📊 CHART</a>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:10px;margin-bottom:5px;">';
    html += '<div><span class="muted">ENTRY</span><br><strong>'+s.entry+'</strong></div>';
    html += '<div><span class="muted">SL</span><br><span class="red">'+s.sl+'</span></div>';
    html += '<div><span class="muted">TP1</span><br><span class="yellow">'+s.tp1+'</span></div>';
    html += '<div><span class="muted">TP2</span><br><span class="green">'+s.tp2+'</span></div>';
    html += '</div>';
    html += '<div class="muted" style="font-size:10px;margin-bottom:4px;">R:R '+s.rr+' · Size '+s.size+' '+(s.unit||'')+' · Risk $'+s.risk_usd+' · WR '+s.wr+'</div>';
    if (s.reasons && s.reasons.length) {
      html += '<div style="font-size:10px;color:var(--muted);max-height:60px;overflow-y:auto;">'+s.reasons.slice(0, 3).join(' · ')+'</div>';
    }
    if (setups.length > 1) {
      html += '<div class="muted" style="font-size:9px;margin-top:4px;border-top:1px dotted var(--border);padding-top:3px;">+ '+(setups.length-1)+' autres setups · click TRADE button au top pour voir tous</div>';
    }
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p class="muted">Setups unavailable</p>';
  }
}

// ── ALERTS CENTER ──
async function loadAlertsCenter() {
  const el = document.getElementById('alertsCenter');
  if (!el) return;
  try {
    const data = await fetch('/api/alerts').then(r => r.json());
    const alerts = data.alerts || [];
    if (alerts.length === 0) {
      el.innerHTML = '<p class="muted" style="padding:6px;">No alerts. System calm.</p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:4px;">' + alerts.length + ' alerts · ' + new Date(data.timestamp).toLocaleTimeString() + '</div>';
    alerts.slice(0, 20).forEach(a => {
      const col = a.level === 'CRITICAL' ? 'var(--red)' : a.level === 'HIGH' ? 'var(--orange)' : a.level === 'MED' ? 'var(--yellow)' : 'var(--muted)';
      const bg = a.level === 'CRITICAL' ? 'rgba(255,56,56,0.08)' : 'transparent';
      const srcCol = { SCAN:'cyan', NEWS:'amber', CAL:'purple', PORTFOLIO:'green' }[a.source] || 'muted';
      html += '<div style="border-left:2px solid '+col+';padding:3px 8px;margin-bottom:2px;font-size:10px;background:'+bg+';">'
        + '<span class="' + srcCol + '" style="font-size:8px;font-weight:bold;letter-spacing:1px;">['+a.source+']</span> '
        + '<span style="color:'+col+';">[' + a.level + ']</span> '
        + a.text
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Error loading alerts</p>'; }
}

// ── KEY LEVELS (PDH/PDL/PWH/PWL from scan, fallback to positions) ──
async function renderKeyLevels(scan) {
  const el = document.getElementById('keyLevels');
  if (!el) return;
  const syms = (scan.symbols || []).filter(s => s.tf_240?.['PDH / PDL'] || s.tf_240?.['PWH / PWL']);
  if (syms.length > 0) {
    // MCP online path
    let html = '<table style="font-size:10px;"><tr><th>Sym</th><th>Price</th><th>PDH</th><th>PDL</th><th>PWH</th><th>PWL</th></tr>';
    syms.slice(0, 8).forEach(s => {
      const pd = (s.tf_240?.['PDH / PDL'] || '').split('/').map(x => x.trim());
      const pw = (s.tf_240?.['PWH / PWL'] || '').split('/').map(x => x.trim());
      const pdh = parseFloat(pd[0]) || null;
      const pdl = parseFloat(pd[1]) || null;
      const pwh = parseFloat(pw[0]) || null;
      const pwl = parseFloat(pw[1]) || null;
      const px = s.price;
      const nearPDH = pdh && Math.abs(px - pdh) / px < 0.003 ? 'amber' : '';
      const nearPDL = pdl && Math.abs(px - pdl) / px < 0.003 ? 'amber' : '';
      html += '<tr><td><strong>'+s.symbol+'</strong></td><td>'+px+'</td>'
        + '<td class="'+nearPDH+'">'+(pdh||'—')+'</td><td class="'+nearPDL+'">'+(pdl||'—')+'</td>'
        + '<td>'+(pwh||'—')+'</td><td>'+(pwl||'—')+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
    return;
  }

  // FALLBACK: show broker position entry/SL/TP levels when MCP offline
  try {
    const broker = await fetch('/api/broker').then(r => r.json()).catch(() => ({}));
    const brokerPos = broker.positions || [];
    const allPos = brokerPos.map(p => ({ symbol: p.symbol, src: 'LIVE', entry: p.entry, sl: p.sl, tp1: null, tp2: p.tp }));
    if (allPos.length === 0) {
      el.innerHTML = '<p class="muted" style="padding:6px;font-size:10px;">MCP offline · pas de levels disponibles.<br>Lance <code style="background:#222;padding:1px 3px;">tv_health_check</code> + <code style="background:#222;padding:1px 3px;">node auto-scan.js</code></p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:4px;">MCP offline — broker position levels:</div>';
    html += '<table style="font-size:10px;"><tr><th>Sym</th><th>Src</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th></tr>';
    allPos.forEach(p => {
      html += '<tr><td><strong>'+p.symbol+'</strong></td>'
        + '<td><span class="badge badge-win">'+p.src+'</span></td>'
        + '<td>'+(p.entry||'—')+'</td>'
        + '<td class="red">'+(p.sl||'—')+'</td>'
        + '<td class="yellow">'+(p.tp1||'—')+'</td>'
        + '<td class="green">'+(p.tp2||'—')+'</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p class="muted">Error loading levels</p>';
  }
}

// ── POSITION SIZE CALCULATOR ──
// Pip values per symbol class (approximations for lot size calc)
const PIP_VALUES = {
  forex: 10,      // EURUSD, GBPUSD @ 1 lot = $10/pip
  jpy: 9,         // USDJPY @ 1 lot = ~$9/pip (at 110)
  xauusd: 100,    // $1 move on 1 lot XAUUSD = $100
  xagusd: 50,     // $0.01 on silver 1 lot = $5 (std contract 5000oz → $50/$1)
  oil: 100,       // $1 move on 1 lot USOIL = $100
  nas: 1,         // 1 pt move on 1 lot NAS100 CFD = $1
  crypto: 1       // 1 unit per $1 move
};
function calcPosition() {
  const bal = parseFloat(document.getElementById('psBal').value) || 0;
  const riskPct = parseFloat(document.getElementById('psRisk').value) || 0;
  const slDist = parseFloat(document.getElementById('psSL').value) || 0;
  const symClass = document.getElementById('psSym').value;
  const resEl = document.getElementById('psResult');

  if (bal <= 0 || riskPct <= 0 || slDist <= 0) {
    resEl.innerHTML = '<span class="red">Fill balance, risk% and SL distance</span>';
    return;
  }
  const riskUSD = bal * riskPct / 100;
  const pipVal = PIP_VALUES[symClass] || 10;
  let pipsSL = slDist;
  if (symClass === 'forex') pipsSL = slDist * 10000;
  if (symClass === 'jpy') pipsSL = slDist * 100;
  if (symClass === 'xauusd' || symClass === 'oil') pipsSL = slDist;
  if (symClass === 'xagusd') pipsSL = slDist * 100;
  if (symClass === 'nas') pipsSL = slDist;
  if (symClass === 'crypto') pipsSL = slDist;

  const rawLots = riskUSD / (pipsSL * pipVal);
  const MIN_LOT = 0.01;
  const belowMin = rawLots < MIN_LOT;
  // Round to nearest 0.01 (broker granularity)
  const lots = Math.max(MIN_LOT, Math.round(rawLots * 100) / 100);
  const microlots = Math.round(lots * 100);
  const actualRisk = pipsSL * pipVal * lots;

  let html = '<div class="' + (belowMin ? 'yellow' : 'green') + '">Lot: <strong>' + lots.toFixed(2) + '</strong> (' + microlots + ' micro)</div>';
  html += '<div class="muted">Risk: $' + actualRisk.toFixed(2) + ' (' + (actualRisk/bal*100).toFixed(2) + '%)</div>';
  html += '<div class="muted" style="font-size:9px;">SL ' + pipsSL.toFixed(1) + ' pts · $' + pipVal + '/pt</div>';
  if (belowMin) {
    html += '<div class="yellow" style="font-size:9px;margin-top:4px;">⚠️ Ideal lot ' + rawLots.toFixed(4) + ' is below broker min 0.01. Actual risk will exceed target — reduce SL distance or accept.</div>';
  } else if (microlots >= 3) {
    // Margin stacking suggestion: split into equal chunks of 0.01
    const chunks = Math.min(5, microlots);
    const perChunk = Math.floor(microlots / chunks);
    html += '<div class="amber" style="font-size:9px;margin-top:4px;">Margin stack: <strong>' + chunks + '× ' + (perChunk * 0.01).toFixed(2) + '</strong> lots (ladder entry)</div>';
  }
  resEl.innerHTML = html;
}

// ── CORRELATION MATRIX ──
async function loadCorrelations() {
  const el = document.getElementById('correlationMatrix');
  if (!el) return;
  try {
    const data = await fetch('/api/correlations').then(r => r.json());
    if (!data.symbols || data.symbols.length === 0) {
      el.innerHTML = '<p class="muted">' + (data.note || 'No correlation data') + '</p>';
      return;
    }
    let html = '<div class="muted" style="font-size:9px;margin-bottom:4px;">' + data.symbols.length + ' symbols · ' + data.samples + ' samples</div>';
    html += '<table style="font-size:9px;border-collapse:collapse;"><tr><th></th>';
    data.symbols.forEach(s => html += '<th style="padding:2px 4px;font-size:8px;">'+s.substring(0,5)+'</th>');
    html += '</tr>';
    data.matrix.forEach((row, i) => {
      html += '<tr><th style="text-align:left;font-size:9px;padding:2px 4px;">'+data.symbols[i]+'</th>';
      row.forEach((v, j) => {
        if (v === null) { html += '<td style="padding:2px 4px;color:#444;">·</td>'; return; }
        // Color: green for positive, red for negative, intensity by magnitude
        const r = Math.floor(Math.abs(v) * 255);
        const color = v > 0 ? 'rgba(0,' + r + ',' + Math.floor(r/3) + ',0.6)' : 'rgba(' + r + ',30,30,0.6)';
        const textCol = Math.abs(v) > 0.6 ? '#fff' : '#aaa';
        html += '<td style="padding:2px 4px;background:'+color+';color:'+textCol+';text-align:center;">'+v.toFixed(2)+'</td>';
      });
      html += '</tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<p class="muted">Error: '+e.message+'</p>'; }
}

// ── ECONOMIC CALENDAR ──
async function loadCalendar() {
  const el = document.getElementById('econCalendar');
  if (!el) return;
  try {
    const cal = await fetch('/api/calendar').then(r => r.json());
    const events = cal.events || [];
    const now = new Date();
    const upcoming = events.filter(e => new Date(e.datetime) > now).slice(0, 10);
    if (upcoming.length === 0) {
      el.innerHTML = '<p class="muted" style="padding:4px;">No upcoming events. Run: <code style="background:#222;padding:1px 3px;">node econ-calendar.js</code></p>';
      return;
    }
    let html = '';
    upcoming.forEach(e => {
      const dt = new Date(e.datetime);
      const deltaH = (dt - now) / 3600000;
      let when;
      if (deltaH < 24) when = Math.floor(deltaH) + 'h' + String(Math.floor((deltaH - Math.floor(deltaH)) * 60)).padStart(2,'0');
      else when = Math.floor(deltaH / 24) + 'd ' + (Math.floor(deltaH) % 24) + 'h';
      const col = e.impact === 'HIGH' ? 'red' : e.impact === 'MEDIUM' ? 'orange' : 'muted';
      html += '<div style="border-left:2px solid var(--' + (e.impact==='HIGH'?'red':e.impact==='MEDIUM'?'orange':'faint') + ');padding:3px 6px;margin-bottom:2px;font-size:10px;">'
        + '<div style="display:flex;justify-content:space-between;">'
        + '<span class="' + col + '" style="font-weight:bold;">' + e.name + '</span>'
        + '<span class="amber" style="font-size:9px;">T-' + when + '</span>'
        + '</div>'
        + '<div class="muted" style="font-size:9px;">' + dt.toUTCString().substring(5, 22) + ' · ' + (e.affects||[]).join(',') + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p class="muted">Calendar unavailable</p>';
  }
}

function renderTicker(scan) {
  const el = document.getElementById('tickerTrack');
  if (!el || !scan.symbols) return;
  const toHTML = arr => arr.map(s => {
    const d = s.tf_240 || {};
    const htf = d['HTF (D)'] || d.HTF || '';
    const cls = isBullish(htf) ? 'tk-up' : isBearish(htf) ? 'tk-dn' : 'tk-nt';
    const arrow = isBullish(htf) ? '▲' : isBearish(htf) ? '▼' : '·';
    return '<span class="tk-item">'
      + '<a href="' + tvUrl(s.symbol) + '" target="_blank" class="tk-sym" style="text-decoration:none;">' + s.symbol + '</a> '
      + '<span class="tk-px">' + s.price + '</span> '
      + '<span class="' + cls + '">' + arrow + '</span></span>';
  }).join('');
  el.innerHTML = toHTML(scan.symbols) + toHTML(scan.symbols);
}

async function refresh() {
  const [scan, fb, setups] = await Promise.all([
    fetch('/api/scan').then(r=>r.json()),
    fetch('/api/feedback').then(r=>r.json()),
    fetch('/api/setups').then(r=>r.json()).catch(()=>({}))
  ]);
  await loadGeoMonitor();
  await loadScanHistory();

  // Market State (was regimeBox)
  const rb = document.getElementById('regimeBox');
  if (rb) {
    const ctx = setups?.market_context || {};
    const reg = ctx.regime || '—';
    const rCol = reg === 'RISK-ON' ? 'green' : reg === 'RISK-OFF' ? 'red' : 'yellow';
    const getBias = s => (s.tf_240?.Structure || s.tf_240?.['HTF (D)'] || s.tf_240?.HTF || '');
    const bullCount = (scan.symbols||[]).filter(s => isBullish(getBias(s))).length;
    const bearCount = (scan.symbols||[]).filter(s => isBearish(getBias(s))).length;
    const totalSym = (scan.symbols||[]).length;
    const longSetups = (setups.setups||[]).filter(s => s.direction === 'LONG').length;
    const shortSetups = (setups.setups||[]).filter(s => s.direction === 'SHORT').length;
    rb.innerHTML =
      '<div class="stat"><span class="label">Regime</span><span class="value '+rCol+'" style="font-size:14px;">'+reg+'</span></div>'
      + '<div class="stat"><span class="label">Session</span><span class="value amber">'+(ctx.session||'—')+'</span></div>'
      + '<div class="stat"><span class="label">Structure</span><span class="value"><span class="green">'+bullCount+' BULL</span> · <span class="red">'+bearCount+' BEAR</span> · <span class="muted">'+(totalSym-bullCount-bearCount)+' NEU</span></span></div>'
      + '<div class="stat"><span class="label">Risk-On / Off</span><span class="value"><span class="green">'+(ctx.riskOn_count||0)+'</span> / <span class="red">'+(ctx.riskOff_count||0)+'</span></span></div>'
      + '<div class="stat"><span class="label">Signals</span><span class="value"><span class="green">'+longSetups+' LONG</span> · <span class="red">'+shortSetups+' SHORT</span></span></div>'
      + '<div class="stat"><span class="label">Symbols Tracked</span><span class="value amber">'+totalSym+'</span></div>';
  }

  // ── BLOOMBERG WIDGETS ──
  renderHeatmap(scan);
  renderTicker(scan);
  renderKillzones();
  renderCrossAsset(scan);
  renderKeyLevels(scan);
  renderBestSetup();
  renderTopMovers(scan);
  renderVolRanking(scan);
  renderMacroBias();
  renderBrokerLive(scan);
  renderNewsStream(LAST_NEWS);
  renderMacroPulse();
  renderCryptoPulse();
  renderYieldCurve();
  renderSectorRotation();
  renderCOT();
  renderOnchain();
  renderEarnings();
  renderSetupTracker();
  renderCurrencyStrength();
  renderVixTerm();
  renderRedditMania();
  renderSetupAlertBanner();
  renderAgentBrief();
  renderMarketWrap();
  renderRiskIndex();
  renderMag7();
  renderSentimentTrend();
  renderCatalyst();
  renderFreshness();
  renderWatchlist();
  renderWEI();
  renderNewsTickerBottom();
  loadCalendar();
  loadAlertsCenter();

  // ── STATUS BAR (top) ──
  const regime = setups?.market_context?.regime || '—';
  const sbRegime = document.getElementById('sbRegime');
  sbRegime.textContent = regime;
  sbRegime.className = 'v ' + (regime === 'RISK-ON' ? 'green' : regime === 'RISK-OFF' ? 'red' : 'yellow');

  // Cross-asset derived metrics for status bar
  const find = (s) => (scan.symbols || []).find(x => x.symbol === s);
  const eur = find('EURUSD'), jpy = find('USDJPY');
  const xau = find('XAUUSD'), xag = find('XAGUSD');
  const oil = find('USOIL');
  const getHtf = s => s?.tf_240?.['HTF (D)'] || s?.tf_240?.HTF || '';
  const biasOf = s => isBullish(getHtf(s)) ? 'BULL' : isBearish(getHtf(s)) ? 'BEAR' : 'NEU';

  // USD: prefer real DXY from macro-pulse, fallback to EUR/JPY proxy
  const sbDxy = document.getElementById('sbDxy');
  try {
    const mp = await fetch('/api/macro-pulse').then(r => r.json());
    if (mp?.data?.dxy) {
      const dxy = mp.data.dxy;
      const col = dxy.changePct > 0 ? 'green' : dxy.changePct < 0 ? 'red' : 'muted';
      sbDxy.textContent = dxy.price.toFixed(1) + ' ' + (dxy.changePct>=0?'+':'') + dxy.changePct.toFixed(2) + '%';
      sbDxy.className = 'v ' + col;
      // VIX cell — replace VOL squeeze count with real VIX if available
      const sbVol = document.getElementById('sbVol');
      if (mp.data.vix && sbVol) {
        const v = mp.data.vix.price;
        const vCol = v < 15 ? 'green' : v < 20 ? 'green' : v < 25 ? 'yellow' : 'red';
        sbVol.textContent = 'VIX ' + v.toFixed(1);
        sbVol.className = 'v ' + vCol;
      }
    } else {
      // Fallback proxy
      let usdLabel = 'NEU', usdCol = 'muted';
      const eurB = biasOf(eur), jpyB = biasOf(jpy);
      if (eurB === 'BEAR' && jpyB === 'BULL') { usdLabel = 'STRONG'; usdCol = 'green'; }
      else if (eurB === 'BULL' && jpyB === 'BEAR') { usdLabel = 'WEAK'; usdCol = 'red'; }
      sbDxy.textContent = usdLabel; sbDxy.className = 'v ' + usdCol;
    }
  } catch(e) {
    let usdLabel = 'NEU', usdCol = 'muted';
    sbDxy.textContent = usdLabel; sbDxy.className = 'v ' + usdCol;
  }

  const sbGold = document.getElementById('sbGold');
  const goldB = biasOf(xau);
  sbGold.textContent = (xau?.price ? xau.price : '—') + ' ' + goldB;
  sbGold.className = 'v ' + (goldB === 'BULL' ? 'green' : goldB === 'BEAR' ? 'red' : 'muted');

  const sbOil = document.getElementById('sbOil');
  const oilB = biasOf(oil);
  sbOil.textContent = (oil?.price ? oil.price : '—') + ' ' + oilB;
  sbOil.className = 'v ' + (oilB === 'BULL' ? 'green' : oilB === 'BEAR' ? 'red' : 'muted');

  // Vol: VIX takes priority (set by macro-pulse block above). Fallback to squeeze count.
  const sbVol = document.getElementById('sbVol');
  if (!sbVol.textContent.startsWith('VIX')) {
    const sqOn = (scan.symbols || []).filter(s => (s.tf_240?.Squeeze || '').includes('🟢')).length;
    sbVol.textContent = sqOn + ' SQ';
    sbVol.className = 'v ' + (sqOn >= 5 ? 'amber' : sqOn >= 2 ? 'yellow' : 'muted');
  }

  // F&G + 10Y yield (from APIs already fetched in panels)
  try {
    const cp = await fetch('/api/crypto-pulse').then(r => r.json());
    const fg = cp.fear_greed?.current;
    if (fg !== undefined) {
      const sbFng = document.getElementById('sbFng');
      const col = fg <= 20 ? 'green' : fg <= 35 ? 'cyan' : fg <= 65 ? 'yellow' : fg <= 80 ? 'orange' : 'red';
      sbFng.textContent = fg + ' ' + (cp.fear_greed.classification || '').substring(0, 4);
      sbFng.className = 'v ' + col;
    }
  } catch(e) {}
  try {
    const mp = await fetch('/api/macro-pulse').then(r => r.json());
    const us10y = mp.data?.us10y;
    const sbYield = document.getElementById('sbYield');
    if (us10y) {
      const col = us10y.changePct > 0 ? 'red' : us10y.changePct < 0 ? 'green' : 'muted'; // rising yields = risk-off
      sbYield.textContent = us10y.price + '%';
      sbYield.className = 'v ' + col;
    }
  } catch(e) {}

  // News + Triggers from LAST_NEWS
  const sbNews = document.getElementById('sbNews');
  const sbTrig = document.getElementById('sbTrig');
  if (LAST_NEWS) {
    const newsCount = (LAST_NEWS.items || []).length;
    sbNews.textContent = newsCount;
    sbNews.className = 'v ' + (newsCount > 50 ? 'amber' : 'muted');
    const trigSet = new Set((LAST_NEWS.critical_triggers || []).map(t => t.trigger));
    const trigN = trigSet.size;
    const extreme = (LAST_NEWS.critical_triggers || []).some(t => t.impact === 'EXTREME');
    sbTrig.textContent = trigN;
    sbTrig.className = 'v ' + (extreme ? 'red' : trigN > 3 ? 'orange' : trigN > 0 ? 'yellow' : 'muted');
  }

  // UPDATED with stale warning
  const sbUpdEl = document.getElementById('sbUpdate');
  if (scan.timestamp) {
    const ageH = (Date.now() - new Date(scan.timestamp).getTime()) / 3600000;
    sbUpdEl.textContent = new Date(scan.timestamp).toLocaleTimeString() + (ageH > 4 ? ' (stale ' + Math.floor(ageH) + 'h)' : '');
    sbUpdEl.className = 'v ' + (ageH > 12 ? 'red' : ageH > 4 ? 'yellow' : 'muted');
  } else {
    sbUpdEl.textContent = '—';
  }
  // MCP status: require at least 50% of symbols with FULL data (Structure or HTF (D))
  const mcpEl = document.getElementById('sbMcp');
  let mcpStatus = scan.mcp_status;
  if (!mcpStatus && scan.symbols?.length) {
    const withFull = scan.symbols.filter(s => {
      const tf = s.tf_240 || {};
      return tf.Structure || tf['HTF (D)'] || tf.Signal || (tf.HTF && (tf.HTF.includes('📈') || tf.HTF.includes('📉')));
    }).length;
    const ratio = withFull / scan.symbols.length;
    mcpStatus = ratio > 0.5 ? 'OK' : ratio > 0.1 ? 'DEGRADED' : 'OFFLINE';
  }
  mcpEl.textContent = mcpStatus || 'OFFLINE';
  mcpEl.className = 'v ' + (mcpStatus === 'OK' ? 'green' : mcpStatus === 'DEGRADED' ? 'yellow' : 'red');

  // Banner: degraded MCP OR stale data (>4h)
  const banner = document.getElementById('mcpBanner');
  if (banner) {
    const ageH = scan.timestamp ? (Date.now() - new Date(scan.timestamp).getTime()) / 3600000 : 0;
    const stale = ageH > 4;
    if (mcpStatus !== 'OK' || stale) {
      banner.style.display = 'block';
      const issue = mcpStatus !== 'OK' ? 'MCP ' + mcpStatus : 'STALE DATA';
      const desc = mcpStatus !== 'OK' ? 'Heatmap/Scanner/KeyLevels degraded' : 'Scan is ' + Math.floor(ageH) + 'h old, prices may have moved significantly';
      banner.innerHTML = '⚠️ <strong>' + issue + '</strong> · ' + desc + ' · '
        + 'To refresh: <code style="background:#000;padding:1px 6px;color:var(--amber);">tv_health_check</code> in Claude Code, then '
        + '<code style="background:#000;padding:1px 6px;color:var(--amber);">cd dashboard && node auto-scan.js</code>';
    } else {
      banner.style.display = 'none';
    }
  }

  // Scanner
  if (scan.symbols?.length) {
    let h = '<table><tr><th>Symbol</th><th>Price</th><th>Struct <span class="help">?<span class="tooltip"><strong>Structure</strong> = direction determinee par les BOS (Break of Structure) et CHoCH (Change of Character). BULL = le prix fait des Higher Highs et Higher Lows.</span></span></th><th>HTF <span class="help">?<span class="tooltip"><strong>HTF Bias</strong> = biais du Daily base sur EMA 20 > 50 > 200 = BULL. Si les 3 sont inversees = BEAR. Sinon NEUTRAL. Override possible si le 4H diverge pendant 5+ barres.</span></span></th><th>Zone <span class="help">?<span class="tooltip"><strong>Zone</strong><br>PREMIUM = au-dessus de l equilibre (vendre).<br>DISCOUNT = en-dessous (acheter).<br>[OTE] = dans la zone Fibonacci optimale 0.62-0.79 pour une entree.</span></span></th><th>MTF <span class="help">?<span class="tooltip"><strong>MTF Alignment</strong><br>3 fleches: Daily / 4H / Current.<br>↑ = bullish, ↓ = bearish, · = neutre.<br>↑↑↑ BULL = alignement parfait = meilleur setup.</span></span></th><th>Conf <span class="help">?<span class="tooltip"><strong>Confluence</strong> = score sur 10 facteurs ICT:<br>1. Structure 2. OB 3. FVG 4. Sweep 5. Volume 6. Killzone 7. HTF 8. Zone 9. OTE 10. Key level.<br>Minimum 4/10 pour un signal.</span></span></th><th>Signal</th><th>WR</th><th>Conv <span class="help">?<span class="tooltip"><strong>Conviction</strong> = score global combinant: confluence + alignement MTF + win rate historique.<br>VERY HIGH = go!<br>HIGH = bon setup.<br>MEDIUM = prudence.<br>LOW/— = pas de trade.</span></span></th><th>TV</th></tr>';
    scan.symbols.forEach(s => {
      const d = s.tf_240 || {};
      const struct = d.Structure||'—'; const htf = d['HTF (D)']||'—'; const zone = d.Zone||'—';
      const mtf = d['MTF (D/4H/cur)']||'—'; const conf = d.Confluence||'—';
      const sig = d.Signal||'NONE'; const wr = d.Record||'—'; const conv = d.Conviction||'—';
      h += '<tr><td><strong>'+tvLink(s.symbol)+'</strong></td><td>'+s.price+'</td>'
        + '<td class="'+(isBullish(struct)?'green':isBearish(struct)?'red':'')+'">'+struct+'</td>'
        + '<td class="'+(isBullish(htf)?'green':isBearish(htf)?'red':'')+'">'+htf+'</td>'
        + '<td>'+zone+'</td>'
        + '<td class="'+(isBullish(mtf)?'green':isBearish(mtf)?'red':'yellow')+'">'+mtf+'</td>'
        + '<td>'+conf+'</td>'
        + '<td><span class="badge '+(sig.includes('LONG')?'badge-long':sig.includes('SHORT')?'badge-short':'badge-none')+'">'+sig.split(' ')[0]+'</span></td>'
        + '<td>'+wr+'</td>'
        + '<td class="'+(conv==='HIGH'||conv==='VERY HIGH'?'green':conv==='MEDIUM'?'yellow':'')+'">'+conv+'</td>'
        + '<td><a href="'+tvUrl(s.symbol)+'" target="_blank" class="btn btn-ghost btn-sm" style="text-decoration:none;">CHART</a></td></tr>';
    });
    document.getElementById('scannerContent').innerHTML = h + '</table>';
  }

  // Feedback (Notes tab)
  const notes = fb.notes || [];
  const flEl = document.getElementById('feedbackList');
  if (flEl) {
    if (!notes.length) flEl.innerHTML = '<p style="color:#616161;">Aucune note. Ajoute des bugs, idees ou feedback sur les trades.</p>';
    else flEl.innerHTML = notes.slice().reverse().map(n => { const t=(n.type||'idea'); return '<div class="feedback-item '+t+'"><strong>['+t.toUpperCase()+']</strong> '+(n.symbol?'<span class="cyan">'+n.symbol+'</span> ':'')+(n.text||'')+'<div class="meta">'+new Date(n.timestamp).toLocaleString()+(n.source?' · '+n.source:'')+'</div></div>'; }).join('');
  }

}

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;

app.listen(PORT, () => console.log('\\x1b[32m%s\\x1b[0m', '  TradeBobby Dashboard v2 running at http://localhost:' + PORT));

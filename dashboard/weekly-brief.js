// ── Weekly Brief Generator ──
// Reads sentiment_history.json + setup_history.json + current data,
// outputs a weekly retrospective in Markdown.
//
// One-shot: node weekly-brief.js
// Daemon (run every Sunday 20:00 UTC+7): node weekly-brief.js --daemon

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'weekly_brief.md');
const LOG = join(__dirname, 'weekly-brief.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function pct(x) { return x.toFixed(1); }
function ago(ms) { return Math.round(ms / 1000) + 's'; }

function run() {
  log('📊 Generating weekly brief...');
  const now = new Date();
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;

  const sentHist = readJSON(join(__dirname, 'sentiment_history.json')) || { snapshots: [] };
  const setupHist = readJSON(join(__dirname, 'setup_history.json')) || { setups: [] };
  const setupStats = readJSON(join(__dirname, 'setup_stats.json')) || {};
  const brief = readJSON(join(__dirname, 'trade_brief.json')) || {};
  const cot = readJSON(join(__dirname, 'cot.json')) || {};
  const macro = readJSON(join(__dirname, 'macro_pulse.json')) || { data: {} };
  const crypto = readJSON(join(__dirname, 'crypto_pulse.json')) || {};
  const news = readJSON(join(__dirname, 'news_feed.json')) || { items: [], sentiment: {}, critical_triggers: [] };

  // Filter snapshots to last 7 days
  const weekSnaps = sentHist.snapshots.filter(s => new Date(s.t).getTime() >= weekAgo);
  const weekSetups = setupHist.setups.filter(s => new Date(s.first_seen).getTime() >= weekAgo);

  // Compute weekly aggregates
  const risks = weekSnaps.map(s => s.risk).filter(Number.isFinite);
  const vixSeries = weekSnaps.map(s => s.vix).filter(Number.isFinite);
  const fgSeries = weekSnaps.map(s => s.fg).filter(Number.isFinite);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const minOf = arr => arr.length ? Math.min(...arr) : null;
  const maxOf = arr => arr.length ? Math.max(...arr) : null;

  const md = [];
  md.push(`# 📊 TradeBobby — Weekly Brief`);
  md.push(`_Period: ${new Date(weekAgo).toISOString().substring(0, 10)} → ${now.toISOString().substring(0, 10)}_`);
  md.push(``);

  // Section 1: Regime evolution
  md.push(`## 🎚 Regime evolution`);
  if (risks.length > 0) {
    md.push(`- Risk Index avg: **${pct(avg(risks))}** · min ${minOf(risks)} · max ${maxOf(risks)}`);
    md.push(`- Δ over week: **${pct(risks[risks.length - 1] - risks[0])}** (${risks.length} snapshots)`);
  }
  if (vixSeries.length) {
    md.push(`- VIX avg: **${pct(avg(vixSeries))}** · range ${pct(minOf(vixSeries))} - ${pct(maxOf(vixSeries))}`);
  }
  if (fgSeries.length) {
    md.push(`- Crypto F&G avg: **${pct(avg(fgSeries))}** · range ${minOf(fgSeries)} - ${maxOf(fgSeries)}`);
  }
  const labels = {};
  weekSnaps.forEach(s => { labels[s.label] = (labels[s.label] || 0) + 1; });
  const labelDist = Object.entries(labels).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
  if (labelDist) md.push(`- Time spent in: ${labelDist}`);
  md.push(``);

  // Section 2: Setup performance
  md.push(`## 🎯 Signal performance (V5 setups this week)`);
  md.push(`- New setups generated: **${weekSetups.length}**`);
  md.push(`- Total tracked all-time: **${setupHist.setups.length}**`);
  if (setupStats.total_closed > 0) {
    md.push(`- Win rate: **${setupStats.win_rate || 0}%** (${setupStats.wins || 0}W / ${setupStats.losses || 0}L)`);
    md.push(`- Total R: **${setupStats.total_r || 0}R** · avg per trade: ${setupStats.avg_r_per_trade || 0}R`);
  }
  if (setupStats.by_quality) {
    md.push(``);
    md.push(`### By quality`);
    md.push(`| Quality | N | Win Rate | Total R |`);
    md.push(`|---|---|---|---|`);
    Object.entries(setupStats.by_quality).forEach(([q, d]) => {
      md.push(`| ${q} | ${d.total} | ${d.win_rate}% | ${d.total_r}R |`);
    });
  }
  if (setupStats.by_symbol && Object.keys(setupStats.by_symbol).length) {
    md.push(``);
    md.push(`### By symbol`);
    md.push(`| Symbol | N | Win Rate | Total R |`);
    md.push(`|---|---|---|---|`);
    Object.entries(setupStats.by_symbol).slice(0, 10).forEach(([s, d]) => {
      md.push(`| ${s} | ${d.total} | ${d.win_rate}% | ${d.total_r}R |`);
    });
  }
  md.push(``);

  // Section 3: Macro snapshot
  md.push(`## 📈 Macro state (now)`);
  const d = macro.data || {};
  md.push(`- DXY: **${d.dxy?.price || '—'}** (${d.dxy?.changePct >= 0 ? '+' : ''}${(d.dxy?.changePct || 0).toFixed(2)}%)`);
  md.push(`- VIX: **${d.vix?.price || '—'}** · term: ${macro.regime?.vix_term_state || '—'}`);
  md.push(`- US10Y: ${d.us10y?.price || '—'}% · curve: ${macro.regime?.yield_curve || '—'} (${macro.regime?.yield_curve_value || 0})`);
  md.push(`- Gold: ${d.gold_f?.price || '—'} · Silver: ${d.silver_f?.price || '—'} · G/S: ${d.gold_silver_ratio || '—'}`);
  md.push(`- WTI: ${d.oil_f?.price || '—'} · Brent: ${d.brent_f?.price || '—'}`);
  md.push(`- BTC: ${crypto.funding?.tracked?.BTCUSDT?.mark || '—'} · F&G: ${crypto.fear_greed?.current || '—'} (${crypto.fear_greed?.classification || '—'})`);
  md.push(``);

  // Section 4: COT extremes this week
  const extremes = (cot.markets || []).filter(m => m.signal?.extreme);
  if (extremes.length) {
    md.push(`## 🏛 COT extremes (CFTC ${cot.report_date || '—'})`);
    md.push(`| Asset | Bias | %Long | Pctile |`);
    md.push(`|---|---|---|---|`);
    extremes.forEach(m => {
      md.push(`| ${m.label} | ${m.signal.bias} | ${m.signal.pct_long}% | ${m.signal.percentile_8w} |`);
    });
    md.push(``);
  }

  // Section 5: News theme intensity
  const cats = news.categories || {};
  if (Object.keys(cats).length) {
    md.push(`## 📰 News theme intensity (last scan)`);
    md.push(`| Category | Items | Triggers |`);
    md.push(`|---|---|---|`);
    Object.entries(cats).forEach(([k, v]) => md.push(`| ${k} | ${v.count} | ${v.triggers} |`));
    md.push(``);
  }

  // Section 6: This week's key takeaways
  md.push(`## 🎯 Takeaways`);
  if (risks.length > 1) {
    const trend = risks[risks.length - 1] - risks[0];
    if (Math.abs(trend) > 10) md.push(`- Risk regime **${trend > 0 ? 'IMPROVED' : 'DEGRADED'}** by ${Math.abs(trend).toFixed(0)} pts`);
  }
  if (extremes.length > 0) md.push(`- ${extremes.length} COT extreme(s) active → contrarian opportunities still available`);
  const uniqueTrigs = new Set((news.critical_triggers || []).map(t => t.trigger));
  if (uniqueTrigs.size > 5) md.push(`- News stress elevated: ${uniqueTrigs.size} unique active triggers`);
  if (setupStats.win_rate >= 55) md.push(`- ✅ Signal quality holding: ${setupStats.win_rate}% WR over ${setupStats.total_closed} closed`);
  else if (setupStats.win_rate > 0) md.push(`- ⚠ Signal quality needs review: ${setupStats.win_rate}% WR`);

  // Section 7: Setup recommendations for next week
  md.push(``);
  md.push(`## 🚀 Setups to watch next week`);
  if (brief.ideas?.length) {
    brief.ideas.slice(0, 5).forEach((i, idx) => {
      md.push(`${idx + 1}. **${i.grade} ${i.direction} ${i.symbol}** (score ${i.synthesis_score})`);
      if (i.entry) md.push(`   - Entry ${i.entry} · SL ${i.sl} · TP ${i.tp2 || i.tp1 || '—'}`);
      (i.reasons || []).slice(0, 2).forEach(r => md.push(`   - ${r}`));
    });
  }

  md.push(``);
  md.push(`---`);
  md.push(`_Generated by trade-agent + weekly-brief.js · ${now.toISOString()}_`);

  const text = md.join('\n');
  writeFileSync(OUT, text);
  log(`✅ Weekly brief written (${text.length} chars, ${weekSnaps.length} snapshots, ${weekSetups.length} new setups)`);
  return text;
}

if (process.argv.includes('--daemon')) {
  // Generate immediately + then re-generate every Sunday 20:00 UTC+7 (13:00 UTC).
  // try/catch so a throw can't kill the daemon; lastRunDate so the Sunday window fires once per day.
  try { run(); } catch (e) { log('❌ ' + e.message); }
  let lastRunDate = null;
  setInterval(() => {
    const utc = new Date();
    const today = utc.toISOString().substring(0, 10);
    if (utc.getUTCDay() === 0 && utc.getUTCHours() === 13 && lastRunDate !== today) {
      lastRunDate = today;
      try { run(); } catch (e) { log('❌ ' + e.message); }
    }
  }, 5 * 60 * 1000);
} else {
  try { run(); } catch (e) { log('❌ ' + e.message); process.exit(1); }
}

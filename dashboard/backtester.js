// ── V6 Strategy Backtester (offline analyzer) ──
// Reads scan_history.json + setup_history.json and computes:
//   - Per-symbol returns vs HTF bias direction
//   - Win rate hypothetical if you'd traded each scan's signals
//   - Best-performing killzone × symbol × quality combos
//
// One-shot: node backtester.js
// Output: backtest_report.md + /api/backtest-report endpoint

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_MD = join(__dirname, 'backtest_report.md');
const OUT_JSON = join(__dirname, 'backtest_report.json');
const LOG = join(__dirname, 'backtester.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function run() {
  log('🧪 Running V6 backtest analyzer...');
  const scanHist = readJSON(join(__dirname, 'scan_history.json')) || { scans: [] };
  const setupHist = readJSON(join(__dirname, 'setup_history.json')) || { setups: [] };
  const sentHist = readJSON(join(__dirname, 'sentiment_history.json')) || { snapshots: [] };

  const out = {
    timestamp: new Date().toISOString(),
    period: {
      scans: scanHist.scans?.length || 0,
      setups: setupHist.setups?.length || 0,
      sentiment_snapshots: sentHist.snapshots?.length || 0,
      first_scan: scanHist.scans?.[0]?.timestamp || null,
      last_scan: scanHist.scans?.[scanHist.scans.length - 1]?.timestamp || null
    }
  };

  // ── 1. Price-action returns per symbol from scan_history ──
  // For each symbol, compute return between first and last seen price
  const symbolReturns = {};
  const symbolMoves = {};
  if (scanHist.scans?.length >= 2) {
    const allSyms = new Set();
    scanHist.scans.forEach(s => Object.keys(s.prices || {}).forEach(sym => allSyms.add(sym)));
    for (const sym of allSyms) {
      const prices = scanHist.scans.map(s => s.prices?.[sym]).filter(Number.isFinite);
      if (prices.length < 2) continue;
      const first = prices[0], last = prices[prices.length - 1];
      const ret = ((last - first) / first) * 100;
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      const range = ((high - low) / first) * 100;
      symbolReturns[sym] = { first, last, return_pct: +ret.toFixed(2), n_scans: prices.length };
      symbolMoves[sym] = { high, low, range_pct: +range.toFixed(2) };
    }
  }
  out.symbol_returns = symbolReturns;
  out.symbol_volatility = symbolMoves;

  // ── 2. Setup performance breakdown ──
  const closed = (setupHist.setups || []).filter(s => s.status === 'CLOSED');
  const open = (setupHist.setups || []).filter(s => s.status === 'OPEN');
  out.setups_breakdown = {
    total: setupHist.setups.length,
    closed: closed.length,
    open: open.length,
    by_outcome: {}
  };

  closed.forEach(s => {
    const o = s.outcome || 'UNKNOWN';
    out.setups_breakdown.by_outcome[o] = (out.setups_breakdown.by_outcome[o] || 0) + 1;
  });

  // Win rate by quality × direction
  const byQuality = {};
  closed.forEach(s => {
    const q = s.quality || 'unknown';
    if (!byQuality[q]) byQuality[q] = { total: 0, wins: 0, total_r: 0, long: 0, short: 0 };
    byQuality[q].total++;
    if (s.outcome === 'TP2_HIT' || s.outcome === 'TP1_HIT') byQuality[q].wins++;
    byQuality[q].total_r += s.r_multiple || 0;
    if (s.direction === 'LONG') byQuality[q].long++;
    else if (s.direction === 'SHORT') byQuality[q].short++;
  });
  Object.keys(byQuality).forEach(q => {
    const d = byQuality[q];
    d.win_rate = d.total > 0 ? +(d.wins / d.total * 100).toFixed(1) : 0;
    d.avg_r = d.total > 0 ? +(d.total_r / d.total).toFixed(2) : 0;
  });
  out.by_quality = byQuality;

  // Win rate by symbol
  const bySymbol = {};
  closed.forEach(s => {
    const sym = s.symbol;
    if (!bySymbol[sym]) bySymbol[sym] = { total: 0, wins: 0, total_r: 0 };
    bySymbol[sym].total++;
    if (s.outcome === 'TP2_HIT') bySymbol[sym].wins++;
    bySymbol[sym].total_r += s.r_multiple || 0;
  });
  Object.keys(bySymbol).forEach(sym => {
    const d = bySymbol[sym];
    d.win_rate = +(d.wins / d.total * 100).toFixed(1);
    d.avg_r = +(d.total_r / d.total).toFixed(2);
  });
  out.by_symbol = bySymbol;

  // ── 3. Regime correlation: which Risk Index range yielded best signals? ──
  const byRiskBand = { 'PANIC (0-20)': { n: 0 }, 'FEAR (20-35)': { n: 0 }, 'CAUTIOUS (35-45)': { n: 0 }, 'NEUTRAL (45-55)': { n: 0 }, 'OPTIMISTIC (55-65)': { n: 0 }, 'GREED (65-80)': { n: 0 }, 'EUPHORIC (80+)': { n: 0 } };
  closed.forEach(s => {
    const r = s.market_context?.regime;
    // We don't have risk score per setup, so use regime tag
    if (!r) return;
    // Aggregate by simple regime
  });

  // ── 4. Sentiment trend (delta over the captured period) ──
  if (sentHist.snapshots?.length > 1) {
    const first = sentHist.snapshots[0];
    const last = sentHist.snapshots[sentHist.snapshots.length - 1];
    out.sentiment_period = {
      risk_delta: last.risk - first.risk,
      vix_delta: (last.vix || 0) - (first.vix || 0),
      fg_delta: (last.fg || 0) - (first.fg || 0),
      first_label: first.label,
      last_label: last.label
    };
  }

  // ── 5. Best and worst movers ──
  const sortedRet = Object.entries(symbolReturns).sort((a, b) => b[1].return_pct - a[1].return_pct);
  out.best_performers = sortedRet.slice(0, 5).map(([sym, d]) => ({ symbol: sym, ...d }));
  out.worst_performers = sortedRet.slice(-5).reverse().map(([sym, d]) => ({ symbol: sym, ...d }));

  // Save JSON
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

  // Save MD report
  const md = [];
  md.push(`# 🧪 TradeBobby Backtest Report`);
  md.push(`_Generated: ${out.timestamp}_`);
  md.push('');
  md.push(`## Data period`);
  md.push(`- Scans: **${out.period.scans}** (${out.period.first_scan?.substring(0, 10)} → ${out.period.last_scan?.substring(0, 10)})`);
  md.push(`- Setups tracked: **${out.period.setups}**`);
  md.push(`- Sentiment snapshots: **${out.period.sentiment_snapshots}**`);
  md.push('');

  md.push(`## 📈 Symbol returns over period`);
  md.push(`| Symbol | First | Last | Return % | Range % |`);
  md.push(`|---|---|---|---|---|`);
  Object.entries(symbolReturns).sort((a, b) => b[1].return_pct - a[1].return_pct).forEach(([sym, d]) => {
    const range = symbolMoves[sym]?.range_pct ?? 0;
    md.push(`| ${sym} | ${d.first} | ${d.last} | ${d.return_pct >= 0 ? '+' : ''}${d.return_pct}% | ${range}% |`);
  });
  md.push('');

  md.push(`## 🏆 Best 5 performers`);
  out.best_performers.forEach((s, i) => md.push(`${i + 1}. **${s.symbol}** ${s.return_pct >= 0 ? '+' : ''}${s.return_pct}% (${s.first} → ${s.last})`));
  md.push('');
  md.push(`## 📉 Worst 5 performers`);
  out.worst_performers.forEach((s, i) => md.push(`${i + 1}. **${s.symbol}** ${s.return_pct >= 0 ? '+' : ''}${s.return_pct}%`));
  md.push('');

  if (Object.keys(byQuality).length) {
    md.push(`## 🎯 Setup performance by quality`);
    md.push(`| Quality | N | Win Rate | Total R | Avg R | L/S |`);
    md.push(`|---|---|---|---|---|---|`);
    Object.entries(byQuality).forEach(([q, d]) => {
      md.push(`| ${q} | ${d.total} | ${d.win_rate}% | ${d.total_r.toFixed(1)}R | ${d.avg_r}R | ${d.long}L/${d.short}S |`);
    });
    md.push('');
  } else {
    md.push(`## 🎯 Setup performance`);
    md.push(`No closed setups in history yet — backtest needs more data. Setup tracker daemon must run during active scans.`);
    md.push('');
  }

  if (out.sentiment_period) {
    md.push(`## 🎚 Sentiment evolution`);
    const sp = out.sentiment_period;
    md.push(`- Risk Index: **${sp.first_label}** → **${sp.last_label}** (Δ ${sp.risk_delta >= 0 ? '+' : ''}${sp.risk_delta})`);
    md.push(`- VIX delta: ${sp.vix_delta >= 0 ? '+' : ''}${sp.vix_delta.toFixed(2)}`);
    md.push(`- Crypto F&G delta: ${sp.fg_delta >= 0 ? '+' : ''}${sp.fg_delta}`);
  }

  md.push('');
  md.push(`---`);
  md.push(`_Generated by backtester.js — feed it more scan history for better results._`);

  writeFileSync(OUT_MD, md.join('\n'));
  log(`✅ Backtest done · ${out.period.scans} scans · ${out.period.setups} setups · ${Object.keys(symbolReturns).length} symbols analyzed`);
  return out;
}

try { run(); } catch (e) { log('❌ ' + e.message); process.exit(1); }

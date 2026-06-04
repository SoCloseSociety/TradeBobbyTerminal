// ── Pattern Recognition Analyzer ──
// Looks at setup_history + sentiment_history + scan_history
// to identify which combinations (symbol × quality × regime × killzone × VIX state)
// historically yield the highest win rates.
//
// One-shot: node pattern-analyzer.js
// Output: pattern_insights.json + console summary

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'pattern_insights.json');
const LOG = join(__dirname, 'pattern-analyzer.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Bucket VIX into regime labels
function vixBucket(v) {
  if (v == null) return 'unknown';
  if (v < 15) return 'complacent';
  if (v < 20) return 'normal';
  if (v < 25) return 'elevated';
  if (v < 35) return 'high';
  return 'extreme';
}
function fgBucket(fg) {
  if (fg == null) return 'unknown';
  if (fg <= 20) return 'extreme-fear';
  if (fg <= 35) return 'fear';
  if (fg <= 50) return 'neutral';
  if (fg <= 65) return 'greed';
  if (fg <= 80) return 'greed-high';
  return 'extreme-greed';
}
function killzoneOf(iso) {
  const d = new Date(iso);
  const utcH = d.getUTCHours();
  // UTC+7 mapping
  const localH = (utcH + 7) % 24;
  if (localH >= 3 && localH < 14) return 'asia';
  if (localH >= 14 && localH < 19) return 'london';
  if (localH >= 19 && localH < 22) return 'ny-overlap';
  if (localH >= 22 || localH < 3) return 'ny';
  return 'inter';
}

function aggregate(setups, key) {
  const groups = {};
  for (const s of setups) {
    const k = typeof key === 'function' ? key(s) : s[key];
    if (k == null) continue;
    if (!groups[k]) groups[k] = { total: 0, wins: 0, losses: 0, expired: 0, total_r: 0 };
    groups[k].total++;
    if (s.outcome === 'TP2_HIT') groups[k].wins++;
    else if (s.outcome === 'SL_HIT') groups[k].losses++;
    else if (s.outcome?.includes('EXPIRED')) groups[k].expired++;
    groups[k].total_r += s.r_multiple || 0;
  }
  return Object.entries(groups).map(([k, v]) => ({
    key: k, ...v,
    win_rate: v.total > 0 ? +(v.wins / v.total * 100).toFixed(1) : 0,
    avg_r: v.total > 0 ? +(v.total_r / v.total).toFixed(2) : 0
  })).sort((a, b) => b.win_rate - a.win_rate);
}

function run() {
  log('🧠 Running pattern analyzer...');
  const setupHist = readJSON(join(__dirname, 'setup_history.json')) || { setups: [] };
  const sentHist = readJSON(join(__dirname, 'sentiment_history.json')) || { snapshots: [] };

  const closed = (setupHist.setups || []).filter(s => s.status === 'CLOSED');

  const out = {
    timestamp: new Date().toISOString(),
    setups_analyzed: closed.length,
    insights: {}
  };

  if (closed.length < 5) {
    out.note = `Insufficient data — need ≥5 closed setups for meaningful patterns (have ${closed.length}). Run setup-tracker daemon during active scans to accumulate.`;
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    log(`⏸ ${out.note}`);
    return out;
  }

  // Enrich each closed setup with sentiment snapshot at first_seen
  const sentByTime = (sentHist.snapshots || []).map(s => ({ t: new Date(s.t).getTime(), ...s }));
  for (const s of closed) {
    const t = new Date(s.first_seen).getTime();
    const nearest = sentByTime.reduce((best, cur) => {
      const d = Math.abs(cur.t - t);
      return d < (best ? best.diff : Infinity) ? { ...cur, diff: d } : best;
    }, null);
    if (nearest && nearest.diff < 6 * 3600 * 1000) {
      s._vix = nearest.vix;
      s._fg = nearest.fg;
      s._risk = nearest.risk;
      s._regime_label = nearest.label;
    }
    s._killzone = killzoneOf(s.first_seen);
  }

  // ── Aggregations ──
  out.insights.by_symbol      = aggregate(closed, 'symbol').slice(0, 12);
  out.insights.by_quality     = aggregate(closed, 'quality');
  out.insights.by_direction   = aggregate(closed, 'direction');
  out.insights.by_killzone    = aggregate(closed, s => s._killzone);
  out.insights.by_vix_regime  = aggregate(closed, s => vixBucket(s._vix));
  out.insights.by_fg_regime   = aggregate(closed, s => fgBucket(s._fg));
  out.insights.by_regime_lbl  = aggregate(closed, s => s._regime_label || 'unknown');

  // Combo: quality × killzone (top 8)
  out.insights.combo_quality_killzone = aggregate(closed, s => `${s.quality || '?'} × ${s._killzone}`).slice(0, 10);
  // Combo: symbol × killzone (top 10)
  out.insights.combo_symbol_killzone = aggregate(closed, s => `${s.symbol} × ${s._killzone}`).slice(0, 10);

  // Best combo overall
  const all = [
    ...out.insights.by_quality.map(x => ({ dim: 'quality', ...x })),
    ...out.insights.by_killzone.map(x => ({ dim: 'killzone', ...x })),
    ...out.insights.by_vix_regime.map(x => ({ dim: 'vix_regime', ...x })),
    ...out.insights.combo_quality_killzone.map(x => ({ dim: 'q×kz', ...x }))
  ].filter(x => x.total >= 3);

  out.top_5_winning_combos = all.sort((a, b) => b.win_rate - a.win_rate).slice(0, 5);
  out.top_5_losing_combos = all.sort((a, b) => a.win_rate - b.win_rate).slice(0, 5);

  // Recommendations
  out.recommendations = [];
  const bestKZ = out.insights.by_killzone[0];
  if (bestKZ?.total >= 3 && bestKZ.win_rate >= 60) {
    out.recommendations.push(`✅ Best killzone: ${bestKZ.key} (${bestKZ.win_rate}% WR over ${bestKZ.total} setups)`);
  }
  const worstSym = out.insights.by_symbol[out.insights.by_symbol.length - 1];
  if (worstSym?.total >= 3 && worstSym.win_rate < 40) {
    out.recommendations.push(`⚠ Avoid ${worstSym.key}: ${worstSym.win_rate}% WR (${worstSym.total} setups)`);
  }
  const bestVix = out.insights.by_vix_regime[0];
  if (bestVix?.total >= 3 && bestVix.win_rate >= 60) {
    out.recommendations.push(`✅ Best VIX regime: ${bestVix.key} (${bestVix.win_rate}% WR)`);
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`✅ ${closed.length} setups analyzed · top combo: ${out.top_5_winning_combos[0]?.key || 'none yet'}`);
  return out;
}

try { run(); } catch (e) { log('❌ ' + e.message); process.exit(1); }

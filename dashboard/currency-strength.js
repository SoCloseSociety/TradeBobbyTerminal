// ── Currency Strength Meter ──
// Computes relative strength of major currencies from FX scan + macro pulse.
// Methodology: for each currency, average % change across all pairs where it appears.
// Standalone (reads scan + macro pulse, writes JSON):
//   node currency-strength.js
// Daemon: node currency-strength.js --daemon

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dirname, 'last_scan.json');
const MACRO = join(__dirname, 'macro_pulse.json');
const OUT = join(__dirname, 'currency_strength.json');
const LOG = join(__dirname, 'currency-strength.log');
const log = mkLogger(LOG);

function readJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// FX pairs available + which currency is base/quote
// pair: BASE/QUOTE. Up = BASE strong, QUOTE weak.
const FX_MAP = [
  { pair: 'EURUSD', base: 'EUR', quote: 'USD' },
  { pair: 'GBPUSD', base: 'GBP', quote: 'USD' },
  { pair: 'USDJPY', base: 'USD', quote: 'JPY' },
  { pair: 'GBPJPY', base: 'GBP', quote: 'JPY' },
];

// Yahoo also provides direct DXY which gives USD strength baseline
async function run() {
  const scan = readJSON(SCAN);
  const macro = readJSON(MACRO);
  if (!scan?.symbols) {
    log('⚠ No scan data');
    writeFileSync(OUT, JSON.stringify({ note: 'Need scan data', timestamp: new Date().toISOString() }, null, 2));
    return;
  }

  // Use TF_240 HTF bias as a coarse strength proxy (no live %change in scan).
  // Score: BULL = +1, BEAR = -1, NEUT = 0.
  const symMap = {};
  scan.symbols.forEach(s => { symMap[s.symbol] = s; });

  const isBullish = (s) => s && (s.includes('BULL') || s.includes('📈') || s.includes('🟢'));
  const isBearish = (s) => s && (s.includes('BEAR') || s.includes('📉') || s.includes('🔴'));

  const score = { USD: 0, EUR: 0, GBP: 0, JPY: 0 };
  const count = { USD: 0, EUR: 0, GBP: 0, JPY: 0 };

  FX_MAP.forEach(p => {
    const sym = symMap[p.pair];
    if (!sym) return;
    const tf = sym.tf_240 || {};
    const htf = tf['HTF (D)'] || tf.HTF || '';
    let v = 0;
    if (isBullish(htf)) v = 1;
    else if (isBearish(htf)) v = -1;
    score[p.base] += v;
    score[p.quote] -= v;
    count[p.base]++;
    count[p.quote]++;
  });

  // Pull DXY from macro for absolute USD strength (intraday)
  const dxyChg = macro?.data?.dxy?.changePct;

  // Normalize
  const strength = {};
  Object.keys(score).forEach(c => {
    strength[c] = count[c] > 0 ? +(score[c] / count[c]).toFixed(2) : 0;
  });

  // If DXY data available, blend the live USD signal
  if (dxyChg !== undefined) {
    // DXY +X% should bias USD strength up
    strength.USD = +((strength.USD + Math.tanh(dxyChg / 1.0)) / 2).toFixed(2);
  }

  // Rank
  const ranking = Object.entries(strength)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => ({ currency: c, strength: v }));

  // Best long/short pair recommendation: strongest base + weakest quote
  const strongest = ranking[0];
  const weakest = ranking[ranking.length - 1];
  let bestPair = null;
  if (strongest && weakest && strongest.currency !== weakest.currency) {
    // Find a pair that exposes this delta
    const tryPair = (b, q) => FX_MAP.find(p => p.base === b && p.quote === q);
    let pair = tryPair(strongest.currency, weakest.currency);
    let direction = 'LONG';
    if (!pair) {
      pair = tryPair(weakest.currency, strongest.currency);
      direction = 'SHORT';
    }
    if (pair) {
      bestPair = {
        pair: pair.pair,
        direction,
        rationale: `${strongest.currency} strong (${strongest.strength}) vs ${weakest.currency} weak (${weakest.strength})`
      };
    }
  }

  const out = {
    timestamp: new Date().toISOString(),
    based_on: scan.timestamp,
    strength,
    ranking,
    best_pair: bestPair,
    note: 'Based on TF_240 HTF bias from scan (BULL/BEAR/NEUTRAL). DXY macro overlay for USD if available.'
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const r = ranking.map(x => x.currency + '=' + x.strength).join(' ');
  log(`✅ ${r}` + (bestPair ? ` · best: ${bestPair.direction} ${bestPair.pair}` : ''));
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 5 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

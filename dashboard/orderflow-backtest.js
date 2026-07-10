// ── Orderflow Backtest ──
// Evidence-based backtest of the order-flow divergence signal used by orderflow-crypto.js.
// Replicates the live scanner's EXACT classification (KLINE_WINDOW=30 closed 1m bars,
// delta = takerBuy - (vol - takerBuy), cvd = sum of deltas, price direction over the window):
//   price up  & cvd < 0  -> BEAR_DIV  -> DISTRIBUTION
//   price down & cvd > 0 -> BULL_DIV  -> ACCUMULATION
//   else                 -> NEUTRAL
// The OBI / order-book part is ignored: depth snapshots are not available historically.
//
// Method: fetch ~3000 closed 1m klines per symbol from Binance (paged via &endTime=),
// slide the 30-bar window one bar at a time, classify, then measure forward log-return
// of close over the next 15 / 30 / 60 bars. Reports both the full overlapping series and
// a non-overlapping ("independent") series (>=15 bars between accepted samples per symbol)
// to avoid overlapping-sample inflation.
//
// One-shot only:  node orderflow-backtest.js
// Output: orderflow_backtest.json + orderflow-backtest.log

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'orderflow_backtest.json');
const LOG = join(__dirname, 'orderflow-backtest.log');
const log = mkLogger(LOG);

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const BASE = 'https://api.binance.com';
const KLINE_WINDOW = 30;        // same as the live scanner
const HORIZONS = [15, 30, 60];  // forward bars measured after each classified window
const PAGES = 3;                // 3 x 1000 klines -> ~3000 bars per symbol
const PAGE_LIMIT = 1000;
const INDEP_SPACING = 15;       // min bars between accepted samples per symbol (non-overlapping set)
const REGIMES = ['DISTRIBUTION', 'ACCUMULATION', 'NEUTRAL'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Fetch ~PAGES*1000 1m klines, paging BACKWARDS with &endTime=, oldest-first result.
// Kline layout: [openTime,o,h,l,c,volume,closeTime,quoteVol,trades,takerBuyBase,takerBuyQuote,ignore]
async function fetchKlines(sym) {
  let pages = [];
  let endTime = null;
  for (let p = 0; p < PAGES; p++) {
    await sleep(300); // polite spacing between ALL requests (incl. across symbols)
    const url = `${BASE}/api/v3/klines?symbol=${sym}&interval=1m&limit=${PAGE_LIMIT}` +
      (endTime ? `&endTime=${endTime}` : '');
    const raw = await safeFetch(url);
    if (!Array.isArray(raw) || raw.length === 0) break;
    pages.unshift(raw);
    endTime = raw[0][0] - 1; // next page ends just before this page's first open
  }
  let bars = pages.flat();
  // Drop the last (still-forming) candle so only CLOSED bars are used, like the scanner.
  if (bars.length && bars[bars.length - 1][6] > Date.now()) bars = bars.slice(0, -1);
  // Parse to {close, delta}; skip malformed bars (same guard as the scanner).
  const out = [];
  for (const bar of bars) {
    const close = parseFloat(bar[4]);
    const vol = parseFloat(bar[5]);
    const takerBuy = parseFloat(bar[9]);
    if (!Number.isFinite(close) || !Number.isFinite(vol) || !Number.isFinite(takerBuy)) continue;
    const takerSell = vol - takerBuy;
    out.push({ close, delta: takerBuy - takerSell });
  }
  return out;
}

// EXACT scanner classification for a window of bars (OBI ignored -> the two flow-only
// regimes BULLISH_FLOW/BEARISH_FLOW cannot trigger and collapse into NEUTRAL,
// which matches "obi = 0" in the scanner when the book is unavailable).
function classifyWindow(win) {
  let cvd = 0;
  for (const b of win) cvd += b.delta;
  const firstClose = win[0].close;
  const lastClose = win[win.length - 1].close;
  const priceChangePct = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const priceUp = priceChangePct > 0;
  if (priceUp && cvd < 0) return 'DISTRIBUTION';   // BEAR_DIV
  if (!priceUp && cvd > 0) return 'ACCUMULATION';  // BULL_DIV
  return 'NEUTRAL';
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Aggregate one (regime, horizon) bucket of forward returns (already in bps).
function stats(fwds, regime) {
  if (!fwds.length) return { n: 0, mean_bps: null, median_bps: null, hit_rate: null };
  let hits;
  if (regime === 'ACCUMULATION') hits = fwds.filter(x => x > 0).length;
  else if (regime === 'DISTRIBUTION') hits = fwds.filter(x => x < 0).length;
  else { // NEUTRAL: "hit" = quiet, |fwd| below the group's own median |fwd| (~50% by construction)
    const medAbs = median(fwds.map(Math.abs));
    hits = fwds.filter(x => Math.abs(x) < medAbs).length;
  }
  return {
    n: fwds.length,
    mean_bps: +mean(fwds).toFixed(2),
    median_bps: +median(fwds).toFixed(2),
    hit_rate: +(hits / fwds.length).toFixed(3)
  };
}

async function run() {
  const t0 = Date.now();
  log(`Backtest start · ${SYMBOLS.length} symbols · window ${KLINE_WINDOW} · horizons ${HORIZONS.join('/')}m`);

  // samples[set][horizon][regime] = [fwd_bps, ...]
  const samples = {};
  for (const set of ['overlapping', 'independent']) {
    samples[set] = {};
    for (const h of HORIZONS) {
      samples[set][h] = {};
      for (const r of REGIMES) samples[set][h][r] = [];
    }
  }

  let barsMin = Infinity, barsMax = 0, symbolsUsed = 0;
  for (const sym of SYMBOLS) {
    const bars = await fetchKlines(sym);
    if (bars.length < KLINE_WINDOW + Math.max(...HORIZONS) + 1) {
      log(`  ${sym}: only ${bars.length} bars (skipped)`);
      continue;
    }
    symbolsUsed++;
    barsMin = Math.min(barsMin, bars.length);
    barsMax = Math.max(barsMax, bars.length);

    let counts = { DISTRIBUTION: 0, ACCUMULATION: 0, NEUTRAL: 0 };
    let lastAccepted = -Infinity;
    for (let i = KLINE_WINDOW; i <= bars.length; i++) {
      const regime = classifyWindow(bars.slice(i - KLINE_WINDOW, i));
      counts[regime]++;
      const anchor = bars[i - 1].close; // last closed bar of the window
      const independent = (i - lastAccepted) >= INDEP_SPACING;
      if (independent) lastAccepted = i;
      for (const h of HORIZONS) {
        if (i - 1 + h >= bars.length) continue; // forward window overruns the data
        const fwdBps = Math.log(bars[i - 1 + h].close / anchor) * 10000;
        samples.overlapping[h][regime].push(fwdBps);
        if (independent) samples.independent[h][regime].push(fwdBps);
      }
    }
    log(`  ${sym}: ${bars.length} bars · DIST ${counts.DISTRIBUTION} / ACC ${counts.ACCUMULATION} / NEUT ${counts.NEUTRAL}`);
  }
  if (!symbolsUsed) throw new Error('no symbol returned enough kline data');

  // Aggregate + verdicts
  const per_regime = {};
  const verdicts = {};
  const edgeFound = [];
  for (const h of HORIZONS) {
    per_regime[`fwd_${h}m`] = {};
    for (const r of REGIMES) {
      per_regime[`fwd_${h}m`][r] = {
        overlapping: stats(samples.overlapping[h][r], r),
        independent: stats(samples.independent[h][r], r)
      };
    }
    const neut = per_regime[`fwd_${h}m`].NEUTRAL.independent;
    const acc = per_regime[`fwd_${h}m`].ACCUMULATION.independent;
    const dist = per_regime[`fwd_${h}m`].DISTRIBUTION.independent;
    // Edge vs NEUTRAL baseline, in the direction the signal claims:
    // ACCUMULATION should out-return NEUTRAL; DISTRIBUTION should under-return it.
    const accEdge = (acc.n && neut.n) ? +(acc.mean_bps - neut.mean_bps).toFixed(2) : null;
    const distEdge = (dist.n && neut.n) ? +(neut.mean_bps - dist.mean_bps).toFixed(2) : null;
    const accOk = accEdge !== null && accEdge >= 3 && acc.n >= 30;
    const distOk = distEdge !== null && distEdge >= 3 && dist.n >= 30;
    const part = (name, edge, ok, n) => edge === null
      ? `${name}: no samples`
      : `${name}: ${edge >= 0 ? '+' : ''}${edge} bps vs NEUTRAL (n=${n}${n < 30 ? ', UNDER-SAMPLED' : ''}) -> ${ok ? 'edge in claimed direction' : 'NO EDGE'}`;
    verdicts[`fwd_${h}m`] =
      `${part('ACCUMULATION', accEdge, accOk, acc.n)} | ${part('DISTRIBUTION', distEdge, distOk, dist.n)}` +
      ` [independent samples; strict cutoff: >=3 bps and n>=30]`;
    if (accOk) edgeFound.push(`ACCUMULATION@${h}m`);
    if (distOk) edgeFound.push(`DISTRIBUTION@${h}m`);
  }

  const conclusion = edgeFound.length
    ? `Partial signal detected (${edgeFound.join(', ')}) on ~2 days of 1m data -- still an unvalidated confluence lens; do not trade it standalone without a longer out-of-sample test.`
    : 'NO EDGE: on this sample the 30m CVD/price divergence does not beat the NEUTRAL baseline by >=3 bps at any horizon -- treat it strictly as an unvalidated confluence/context lens, never a standalone signal.';

  const out = {
    generated: new Date().toISOString(),
    source: 'binance 1m klines (closed bars only)',
    symbols: SYMBOLS,
    symbols_used: symbolsUsed,
    bars_per_symbol: { min: barsMin, max: barsMax, target: PAGES * PAGE_LIMIT },
    method: `Exact replication of orderflow-crypto.js classification: ${KLINE_WINDOW}-bar rolling window, ` +
      `delta = takerBuy - (vol - takerBuy), cvd = sum(delta); price up & cvd<0 = DISTRIBUTION (BEAR_DIV), ` +
      `price down & cvd>0 = ACCUMULATION (BULL_DIV), else NEUTRAL. OBI ignored (no historical depth). ` +
      `Forward log-returns of close over ${HORIZONS.join('/')} bars, in bps. 'overlapping' = every bar; ` +
      `'independent' = >=${INDEP_SPACING} bars between accepted samples per symbol (fights overlapping-sample inflation). ` +
      `NEUTRAL hit-rate is |fwd| < group median |fwd| (a ~50% construction, listed only for completeness).`,
    horizons_bars: HORIZONS,
    per_regime,
    verdicts,
    conclusion
  };
  writeJsonAtomic(OUT, out);

  // Compact summary table
  log('── Summary (independent samples, mean fwd bps / n / hit) ──');
  log('regime        ' + HORIZONS.map(h => `| ${String(h).padStart(3)}m`.padEnd(22)).join(''));
  for (const r of REGIMES) {
    let row = r.padEnd(14);
    for (const h of HORIZONS) {
      const s = per_regime[`fwd_${h}m`][r].independent;
      row += `| ${s.n ? `${s.mean_bps >= 0 ? '+' : ''}${s.mean_bps} n=${s.n} hit=${s.hit_rate}` : 'n=0'}`.padEnd(22);
    }
    log(row);
  }
  for (const h of HORIZONS) log(`VERDICT ${h}m: ${verdicts[`fwd_${h}m`]}`);
  log(`CONCLUSION: ${conclusion}`);
  log(`✅ done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
  return out;
}

run().catch(e => { log('❌ ' + e.message); process.exit(1); });

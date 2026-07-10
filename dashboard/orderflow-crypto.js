// ── Orderflow Crypto ──
// REAL order flow for crypto using FREE Binance public data (no API key).
//   * CVD / delta  -> from 1m klines' takerBuyBaseVolume (true taker buy vs sell,
//                     time-consistent, no tick-rule approximation, no paging).
//   * OBI          -> order book imbalance from the live depth snapshot.
//   * Divergence   -> price direction vs CVD direction. This is the actionable edge:
//                     price up + CVD down = distribution (bear div); the reverse = accumulation.
//
// Why this is legit (vs the "orderflow style" indicators sold on Instagram):
//   Binance aggTrade/kline taker-volume IS real aggressor-classified data. On TradingView,
//   Pine footprint is a tick-rule APPROXIMATION and forex/gold tick volume is synthetic/poor.
//   So crypto (excellent data) is where order flow actually carries signal.
//
// This is a CONFLUENCE / CONTEXT lens, NOT a standalone edge. Backtest before trusting it,
// and keep crypto WATCH-ONLY until a validated edge says otherwise (see rules.json).
//
// One-shot:  node orderflow-crypto.js
// Daemon:    node orderflow-crypto.js --daemon     (refresh every 60s)

import { writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'orderflow_crypto.json');
const LOG = join(__dirname, 'orderflow-crypto.log');
const log = mkLogger(LOG);

// Top-liquidity pairs = best order-flow data quality. Easy to extend.
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const BASE = 'https://api.binance.com';
const KLINE_WINDOW = 30;      // 1m bars -> 30 min CVD window
const DEPTH_LIMIT = 500;      // order-book levels per side
const OBI_BAND_PCT = 0.5;     // sum resting liquidity within +/-0.5% of mid for OBI

async function safeFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// CVD / delta / buy-pressure from 1m klines using true taker-buy volume.
// Kline layout: [openTime,o,h,l,c,volume,closeTime,quoteVol,trades,takerBuyBase,takerBuyQuote,ignore]
async function flowFromKlines(sym) {
  // Fetch one extra bar and drop the last (still-forming) candle, so price/delta/divergence
  // reflect only CLOSED bars instead of flip-flopping on partial-bar noise every refresh.
  const raw = await safeFetch(`${BASE}/api/v3/klines?symbol=${sym}&interval=1m&limit=${KLINE_WINDOW + 1}`);
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const k = raw.length > KLINE_WINDOW ? raw.slice(0, -1) : raw;

  let cvd = 0, totalVol = 0, takerBuyTotal = 0;
  const cvdSeries = [];
  for (const bar of k) {
    const vol = parseFloat(bar[5]);
    const takerBuy = parseFloat(bar[9]);
    if (!Number.isFinite(vol) || !Number.isFinite(takerBuy)) continue; // skip a malformed bar
    const takerSell = vol - takerBuy;       // taker buy + taker sell = volume
    const delta = takerBuy - takerSell;     // net aggressive flow for the bar
    cvd += delta;
    cvdSeries.push(+cvd.toFixed(4));
    totalVol += vol;
    takerBuyTotal += takerBuy;
  }
  const firstClose = parseFloat(k[0][4]);
  const lastClose = parseFloat(k[k.length - 1][4]);
  const priceChangePct = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const lastDelta = cvdSeries.length >= 2
    ? cvdSeries[cvdSeries.length - 1] - cvdSeries[cvdSeries.length - 2]
    : cvdSeries[0];

  return {
    price: lastClose,
    cvd: +cvd.toFixed(4),
    last_delta: +lastDelta.toFixed(4),
    buy_ratio: totalVol ? +(takerBuyTotal / totalVol).toFixed(4) : 0.5, // >0.5 = net aggressive buying
    price_change_pct: +priceChangePct.toFixed(3),
    window_min: KLINE_WINDOW
  };
}

// Order Book Imbalance: resting bid vs ask liquidity within a band of mid price.
async function obiFromDepth(sym) {
  const d = await safeFetch(`${BASE}/api/v3/depth?symbol=${sym}&limit=${DEPTH_LIMIT}`);
  if (!d?.bids?.length || !d?.asks?.length) return null; // empty book would throw on [0][0]
  const bestBid = parseFloat(d.bids[0][0]);
  const bestAsk = parseFloat(d.asks[0][0]);
  const mid = (bestBid + bestAsk) / 2;
  const lo = mid * (1 - OBI_BAND_PCT / 100);
  const hi = mid * (1 + OBI_BAND_PCT / 100);

  // Always count the best level (i===0) even when the spread is wider than the band, else a
  // thin pair excludes both bests and reports a meaningless obi:0.
  let bidVol = 0, askVol = 0;
  for (let i = 0; i < d.bids.length; i++) { if (i === 0 || parseFloat(d.bids[i][0]) >= lo) bidVol += parseFloat(d.bids[i][1]); }
  for (let i = 0; i < d.asks.length; i++) { if (i === 0 || parseFloat(d.asks[i][0]) <= hi) askVol += parseFloat(d.asks[i][1]); }
  const tot = bidVol + askVol;
  return {
    obi: (bidVol > 0 && askVol > 0) ? +((bidVol - askVol) / tot).toFixed(4) : null,  // null, never a spurious +/-1
    bid_vol: +bidVol.toFixed(3),
    ask_vol: +askVol.toFixed(3),
    spread_bps: mid ? +(((bestAsk - bestBid) / mid) * 10000).toFixed(2) : 0
  };
}

// Combine flow + book into a regime + the actionable divergence flag.
function classify(flow, book) {
  if (!Number.isFinite(flow.cvd)) return { regime: 'NEUTRAL', divergence: null, notes: '--' };
  const cvdUp = flow.cvd > 0;
  const priceUp = flow.price_change_pct > 0;
  const obi = (book && book.obi != null) ? book.obi : 0;

  let divergence = null;
  // Price rising while net selling = distribution; price falling while net buying = accumulation.
  if (priceUp && flow.cvd < 0) divergence = 'BEAR_DIV';   // weak rally -> reversal-down risk
  if (!priceUp && flow.cvd > 0) divergence = 'BULL_DIV';  // weak dip -> reversal-up potential

  let regime;
  if (divergence === 'BEAR_DIV') regime = 'DISTRIBUTION';
  else if (divergence === 'BULL_DIV') regime = 'ACCUMULATION';
  else if (cvdUp && obi > 0.10) regime = 'BULLISH_FLOW';   // buyers aggressive + bids stacked
  else if (!cvdUp && obi < -0.10) regime = 'BEARISH_FLOW'; // sellers aggressive + asks stacked
  else regime = 'NEUTRAL';

  const notes = [];
  if (regime === 'DISTRIBUTION') notes.push('Price up but CVD down -- selling into strength (reversal-down risk)');
  if (regime === 'ACCUMULATION') notes.push('Price down but CVD up -- buying the dip (reversal-up potential)');
  if (regime === 'BULLISH_FLOW') notes.push('Aggressive buying + bid-heavy book');
  if (regime === 'BEARISH_FLOW') notes.push('Aggressive selling + ask-heavy book');
  if (book && book.obi != null && Math.abs(book.obi) > 0.35) notes.push(`Strong book skew (OBI ${book.obi})`);
  return { regime, divergence, notes: notes.join(' | ') || '--' };
}

async function run() {
  const symbols = [];
  for (const sym of SYMBOLS) {
    const flow = await flowFromKlines(sym).catch(() => null);
    if (!flow) { log(`  ${sym}: no kline data (skipped)`); continue; }
    const book = await obiFromDepth(sym).catch(() => null);
    const cls = classify(flow, book);
    symbols.push({
      symbol: sym,
      price: flow.price,
      cvd: flow.cvd,
      last_delta: flow.last_delta,
      buy_ratio: flow.buy_ratio,
      price_change_pct: flow.price_change_pct,
      window_min: flow.window_min,
      obi: book ? book.obi : null,
      spread_bps: book ? book.spread_bps : null,
      regime: cls.regime,
      divergence: cls.divergence,
      notes: cls.notes
    });
  }

  const bullish = symbols.filter(s => ['BULLISH_FLOW', 'ACCUMULATION'].includes(s.regime)).length;
  const bearish = symbols.filter(s => ['BEARISH_FLOW', 'DISTRIBUTION'].includes(s.regime)).length;
  const divergences = symbols.filter(s => s.divergence).map(s => `${s.symbol}:${s.divergence}`);
  const net_bias = bullish > bearish ? 'NET_BULLISH' : bearish > bullish ? 'NET_BEARISH' : 'MIXED';

  const out = {
    timestamp: new Date().toISOString(),
    source: 'binance',
    method: 'true taker-buy/sell from 1m klines (CVD) + live order-book imbalance (OBI)',
    disclaimer: 'Confluence/context lens, not a standalone edge. Backtest before trusting. Crypto = watch-only until validated.',
    symbols,
    summary: { count: symbols.length, bullish, bearish, divergences, net_bias }
  };
  // Atomic write: a reader (dashboard /api/orderflow) never sees a half-written file.
  writeFileSync(OUT + '.tmp', JSON.stringify(out, null, 2));
  renameSync(OUT + '.tmp', OUT);
  log(`✅ ${symbols.length} pairs · bull ${bullish} / bear ${bearish} · bias ${net_bias}${divergences.length ? ' · DIV ' + divergences.join(',') : ''}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 60 * 1000); // 60s: fresh CVD for the live view
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

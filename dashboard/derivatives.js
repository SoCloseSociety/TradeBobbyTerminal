// ── Derivatives Pulse ──
// Aggregates crypto futures microstructure that the orderflow page needs but Binance SPOT
// doesn't expose: funding rate, open interest (+ trend), long/short ratios, taker volume
// ratio -- from Binance Futures (fapi, keyless, works where Bybit is geo-blocked) + a
// cross-venue funding read from Hyperliquid. Feeds /api/derivatives and the /live page.
// One-shot: node derivatives.js   ·   Daemon (every 60s): node derivatives.js --daemon
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic, readJsonSafe } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'derivatives.json');
const LOG = join(__dirname, 'derivatives.log');
const log = mkLogger(LOG);

const FAPI = 'https://fapi.binance.com';
// Symbols mirror the /live orderflow watchlist (Binance perp names).
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];

async function j(url, opts) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000), ...opts });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function forSymbol(sym) {
  // Parallel pulls per symbol (all keyless Binance fapi + Hyperliquid cross-check).
  const [premium, oiNow, oiHist, gLS, tLS, takerLS] = await Promise.all([
    j(`${FAPI}/fapi/v1/premiumIndex?symbol=${sym}`),
    j(`${FAPI}/fapi/v1/openInterest?symbol=${sym}`),
    j(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=24`),
    j(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`),
    j(`${FAPI}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=5m&limit=1`),
    j(`${FAPI}/futures/data/takerlongshortRatio?symbol=${sym}&period=5m&limit=1`)
  ]);

  const funding = premium ? +premium.lastFundingRate : null;         // per-8h rate
  const mark = premium ? +premium.markPrice : null;
  const nextFundingTime = premium ? +premium.nextFundingTime : null;
  const oi = oiNow ? +oiNow.openInterest : null;                      // in base coin
  const oiValue = (oi != null && mark != null) ? oi * mark : null;    // notional $
  const oiSeries = Array.isArray(oiHist) ? oiHist.map(h => +h.sumOpenInterestValue) : [];
  const oiChangePct = oiSeries.length >= 2 ? ((oiSeries[oiSeries.length - 1] - oiSeries[0]) / oiSeries[0]) * 100 : null;
  const globalLS = gLS?.[0] ? +gLS[0].longShortRatio : null;         // retail accounts
  const topLS = tLS?.[0] ? +tLS[0].longShortRatio : null;           // smart-money positions
  const takerRatio = takerLS?.[0] ? +takerLS[0].buySellRatio : null; // aggressive flow

  // Funding regime: annualized = rate * 3 * 365. >30% = crowded longs (squeeze SHORT risk).
  const fundingAnnual = funding != null ? funding * 3 * 365 * 100 : null;
  let fundingState = 'neutral';
  if (fundingAnnual != null) {
    if (fundingAnnual > 30) fundingState = 'longs-crowded';
    else if (fundingAnnual > 10) fundingState = 'longs-lean';
    else if (fundingAnnual < -10) fundingState = 'shorts-crowded';
    else if (fundingAnnual < 0) fundingState = 'shorts-lean';
  }

  return {
    symbol: sym, mark, funding, funding_annual_pct: fundingAnnual != null ? +fundingAnnual.toFixed(1) : null,
    funding_state: fundingState, next_funding_time: nextFundingTime,
    oi, oi_value: oiValue, oi_change_24h_pct: oiChangePct != null ? +oiChangePct.toFixed(2) : null,
    oi_series: oiSeries.map(v => +(v / 1e9).toFixed(3)), // $B, for sparkline
    ls_global: globalLS, ls_top: topLS, taker_ratio: takerRatio
  };
}

async function hyperliquid() {
  // Cross-venue funding: Hyperliquid (keyless POST). Divergence vs Binance = arb/positioning signal.
  const d = await j('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' })
  });
  if (!Array.isArray(d) || d.length < 2) return {};
  const universe = d[0]?.universe || [];
  const ctxs = d[1] || [];
  const out = {};
  const want = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' };
  universe.forEach((u, i) => {
    if (want[u.name] && ctxs[i]) {
      out[want[u.name]] = { funding: +ctxs[i].funding, oi: +ctxs[i].openInterest, mark: +ctxs[i].markPx };
    }
  });
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  log('🔄 Fetching derivatives...');
  // Process symbols SEQUENTIALLY: firing all 8 symbols x 6 endpoints (48 reqs) at once made
  // Binance fapi rate-limit/drop the burst (every field came back null on 2026-07-12).
  // Serial per-symbol (still 6 parallel calls each) keeps concurrency low and reliable.
  const perSym = [];
  for (const sym of SYMBOLS) { perSym.push(await forSymbol(sym)); await sleep(120); }
  const hl = await hyperliquid();

  const bySymbol = {};
  for (const s of perSym) {
    if (!s) continue;
    if (hl[s.symbol]) {
      s.hl_funding = hl[s.symbol].funding;
      // Binance vs Hyperliquid funding gap (bps of 8h rate) -- venue positioning divergence.
      if (s.funding != null && s.hl_funding != null) s.funding_venue_gap = +((s.funding - s.hl_funding) * 10000).toFixed(2);
    }
    bySymbol[s.symbol] = s;
  }

  // Last-known-good merge so a flaky cycle keeps prior numbers instead of nulling the page.
  const prev = readJsonSafe(OUT) || {};
  const symbols = Object.keys(bySymbol).length ? bySymbol : (prev.symbols || {});

  const out = { timestamp: new Date().toISOString(), symbols };
  writeJsonAtomic(OUT, out);
  const btc = symbols.BTCUSDT || {};
  log(`✅ ${Object.keys(symbols).length} syms · BTC funding ${btc.funding_annual_pct != null ? btc.funding_annual_pct + '%/yr' : '—'} (${btc.funding_state || '—'}) · OI $${btc.oi_value ? (btc.oi_value / 1e9).toFixed(1) + 'B' : '—'} · L/S ${btc.ls_global || '—'}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

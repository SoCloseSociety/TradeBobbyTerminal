// ── Macro Pulse ──
// Fetches DXY, VIX, US Treasury yields, gold/silver ratio from Yahoo Finance public API.
// One-shot: node macro-pulse.js
// Daemon (every 5min): node macro-pulse.js --daemon

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'macro_pulse.json');
const LOG = join(__dirname, 'macro-pulse.log');
const log = mkLogger(LOG);

// Yahoo Finance ticker → label mapping
const TICKERS = [
  { y: '%5ETNX',     k: 'us10y',  label: 'US 10Y',  unit: '%' },
  { y: '%5EFVX',     k: 'us5y',   label: 'US 5Y',   unit: '%' },
  { y: '%5EIRX',     k: 'us3m',   label: 'US 3M',   unit: '%' },
  { y: '%5ETYX',     k: 'us30y',  label: 'US 30Y',  unit: '%' },
  { y: '%5EVIX',     k: 'vix',    label: 'VIX',     unit: '' },
  { y: '%5EVIX9D',   k: 'vix9d',  label: 'VIX 9d',  unit: '' },
  { y: '%5EVIX3M',   k: 'vix3m',  label: 'VIX 3m',  unit: '' },
  { y: '%5EVIX6M',   k: 'vix6m',  label: 'VIX 6m',  unit: '' },
  { y: '%5EMOVE',    k: 'move',   label: 'MOVE',    unit: '' },  // Bond vol
  { y: 'DX-Y.NYB',   k: 'dxy',    label: 'DXY',     unit: '' },
  { y: '%5EGSPC',    k: 'spx',    label: 'S&P 500', unit: '' },
  { y: '%5EVVIX',    k: 'vvix',   label: 'VVIX',    unit: '' },  // Vol of vol
  // Bond/Credit (for HYG/IEF credit spread)
  { y: 'IEF',  k: 'ief',  label: 'IG Bonds (IEF)', unit: '$', credit: true },
  { y: 'LQD',  k: 'lqd',  label: 'IG Corp (LQD)',  unit: '$', credit: true },
  { y: 'JNK',  k: 'jnk',  label: 'Junk (JNK)',     unit: '$', credit: true },
  { y: 'GC%3DF',     k: 'gold_f', label: 'Gold Fut', unit: '$' },
  { y: 'SI%3DF',     k: 'silver_f', label: 'Silver Fut', unit: '$' },
  { y: 'CL%3DF',     k: 'oil_f',  label: 'WTI Fut', unit: '$' },
  { y: 'BZ%3DF',     k: 'brent_f', label: 'Brent Fut', unit: '$' },
  { y: 'HG%3DF',     k: 'copper_f', label: 'Copper Fut', unit: '$' },
  // Sector ETFs (rotation signal)
  { y: 'XLK',  k: 'xlk',  label: 'Tech (XLK)',     unit: '$', sector: true },
  { y: 'XLF',  k: 'xlf',  label: 'Finance (XLF)',  unit: '$', sector: true },
  { y: 'XLE',  k: 'xle',  label: 'Energy (XLE)',   unit: '$', sector: true },
  { y: 'XLV',  k: 'xlv',  label: 'Health (XLV)',   unit: '$', sector: true },
  { y: 'XLI',  k: 'xli',  label: 'Industrial (XLI)', unit: '$', sector: true },
  { y: 'XLY',  k: 'xly',  label: 'Cons Disc (XLY)', unit: '$', sector: true },
  { y: 'XLP',  k: 'xlp',  label: 'Cons Stap (XLP)', unit: '$', sector: true },
  { y: 'XLU',  k: 'xlu',  label: 'Utilities (XLU)', unit: '$', sector: true },
  { y: 'XLB',  k: 'xlb',  label: 'Materials (XLB)', unit: '$', sector: true },
  { y: 'XLRE', k: 'xlre', label: 'Real Est (XLRE)', unit: '$', sector: true },
  { y: 'XLC',  k: 'xlc',  label: 'Comm (XLC)',     unit: '$', sector: true },
  // Thematic ETFs
  { y: 'GDX',  k: 'gdx',  label: 'Gold Miners',    unit: '$', theme: true },
  { y: 'GDXJ', k: 'gdxj', label: 'Junior Miners',  unit: '$', theme: true },
  { y: 'SLV',  k: 'slv',  label: 'Silver ETF',     unit: '$', theme: true },
  { y: 'GLD',  k: 'gld',  label: 'Gold ETF',       unit: '$', theme: true },
  { y: 'TLT',  k: 'tlt',  label: 'Long Bonds',     unit: '$', theme: true },
  { y: 'HYG',  k: 'hyg',  label: 'Junk Bonds',     unit: '$', theme: true },
  { y: 'USO',  k: 'uso',  label: 'Oil ETF',        unit: '$', theme: true },
  { y: 'IBIT', k: 'ibit', label: 'BTC ETF',        unit: '$', theme: true },
  { y: 'ARKK', k: 'arkk', label: 'Innovation',     unit: '$', theme: true },
  { y: 'SMH',  k: 'smh',  label: 'Semiconductors', unit: '$', theme: true },
  // Mag-7 stocks (key NAS movers)
  { y: 'AAPL', k: 'aapl', label: 'Apple',     unit: '$', stock: true },
  { y: 'MSFT', k: 'msft', label: 'Microsoft', unit: '$', stock: true },
  { y: 'GOOGL', k: 'googl', label: 'Alphabet', unit: '$', stock: true },
  { y: 'AMZN', k: 'amzn', label: 'Amazon',    unit: '$', stock: true },
  { y: 'NVDA', k: 'nvda', label: 'Nvidia',    unit: '$', stock: true },
  { y: 'META', k: 'meta', label: 'Meta',      unit: '$', stock: true },
  { y: 'TSLA', k: 'tsla', label: 'Tesla',     unit: '$', stock: true },
];

async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=5m`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const close = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    const high = meta.regularMarketDayHigh;
    const low = meta.regularMarketDayLow;
    const change = (close && prevClose) ? close - prevClose : 0;
    const changePct = (close && prevClose) ? (change / prevClose) * 100 : 0;
    return { price: close, prevClose, high, low, change, changePct, time: meta.regularMarketTime };
  } catch (e) {
    return null;
  }
}

async function run() {
  log('🔄 Fetching macro pulse...');
  const out = { timestamp: new Date().toISOString(), data: {} };
  for (const t of TICKERS) {
    const d = await fetchYahoo(t.y);
    if (d) {
      out.data[t.k] = { ...d, label: t.label, unit: t.unit };
    } else {
      log(`  ⚠ ${t.label} failed`);
    }
    // Light throttle to be polite
    await new Promise(r => setTimeout(r, 150));
  }

  // Derived metrics
  const d = out.data;
  if (d.us10y && d.us3m)   d.spread_10y_3m = +(d.us10y.price - d.us3m.price).toFixed(2);  // Inversion classic recession signal
  if (d.us10y && d.us5y)   d.spread_10y_5y = +(d.us10y.price - d.us5y.price).toFixed(2);
  if (d.gold_f && d.silver_f) d.gold_silver_ratio = +(d.gold_f.price / d.silver_f.price).toFixed(2);
  if (d.brent_f && d.oil_f)  d.brent_wti_spread = +(d.brent_f.price - d.oil_f.price).toFixed(2);

  // Regime classification
  const vix = d.vix?.price ?? null;
  let volRegime = 'unknown';
  if (vix !== null) {
    if (vix < 15) volRegime = 'COMPLACENT';      // Bullish risk
    else if (vix < 20) volRegime = 'NORMAL';
    else if (vix < 25) volRegime = 'ELEVATED';
    else if (vix < 35) volRegime = 'HIGH';
    else volRegime = 'EXTREME';
  }
  out.regime = { vol: volRegime, vix };

  // Yield curve signal
  const sp = d.spread_10y_3m;
  if (sp !== undefined) {
    out.regime.yield_curve = sp < 0 ? 'INVERTED' : sp < 0.5 ? 'FLAT' : 'NORMAL';
    out.regime.yield_curve_value = sp;
  }

  // VIX term structure
  if (d.vix && d.vix3m) {
    const ts = d.vix.price - d.vix3m.price;
    out.regime.vix_term_structure = ts;
    // Backwardation (front > back) = stress; contango (front < back) = calm
    out.regime.vix_term_state = ts > 0 ? 'BACKWARDATION' : ts < -2 ? 'CONTANGO_DEEP' : 'CONTANGO';
  }
  if (d.vix9d && d.vix) {
    out.regime.vix_short_ratio = +(d.vix9d.price / d.vix.price).toFixed(2);  // >1 = front-loaded fear
  }

  // Credit risk gauges
  if (d.hyg && d.ief) {
    out.regime.credit_ratio_hyg_ief = +(d.hyg.price / d.ief.price).toFixed(3);  // >X = risk-on, <Y = risk-off
  }
  if (d.hyg && d.lqd) {
    out.regime.junk_ig_ratio = +(d.hyg.price / d.lqd.price).toFixed(3);
  }
  if (d.jnk && d.lqd) {
    out.regime.jnk_lqd_ratio = +(d.jnk.price / d.lqd.price).toFixed(3);
  }

  // Sector rotation: rank sectors by daily change
  const sectors = TICKERS.filter(t => t.sector).map(t => ({
    key: t.k, label: t.label,
    chg: d[t.k]?.changePct ?? null
  })).filter(s => s.chg !== null);
  sectors.sort((a, b) => b.chg - a.chg);
  out.sector_rotation = {
    leaders: sectors.slice(0, 3),
    laggards: sectors.slice(-3).reverse(),
    risk_on_score: sectors.filter(s => ['xlk','xly','xlc','xlf','xli'].includes(s.key)).reduce((acc, s) => acc + (s.chg || 0), 0),
    risk_off_score: sectors.filter(s => ['xlu','xlp','xlv'].includes(s.key)).reduce((acc, s) => acc + (s.chg || 0), 0)
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const tickers = Object.keys(out.data).length;
  log(`✅ Wrote ${tickers} tickers · vol=${volRegime} · curve=${out.regime.yield_curve || '—'}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 5 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

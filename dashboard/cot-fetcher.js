// ── COT Report Fetcher ──
// Pulls latest CFTC Commitment of Traders (legacy futures-only) for key markets.
// One-shot: node cot-fetcher.js
// Daemon (every 24h, since CFTC publishes weekly Friday): node cot-fetcher.js --daemon

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cot.json');
const LOG = join(__dirname, 'cot.log');
const log = mkLogger(LOG);

// Map of contract_market_name → friendly label and asset
const MARKETS = [
  { match: 'GOLD', asset: 'XAUUSD', label: 'Gold' },
  { match: 'SILVER', asset: 'XAGUSD', label: 'Silver' },
  { match: 'COPPER', asset: 'COPPER', label: 'Copper' },
  { match: 'PLATINUM', asset: 'XPTUSD', label: 'Platinum' },
  { match: 'CRUDE OIL, LIGHT SWEET', asset: 'USOIL', label: 'WTI Crude' },
  { match: 'NAT GAS', asset: 'NATGAS', label: 'Nat Gas' },
  { match: 'EURO FX', asset: 'EURUSD', label: 'EUR' },
  { match: 'BRITISH POUND', asset: 'GBPUSD', label: 'GBP' },
  { match: 'JAPANESE YEN', asset: 'USDJPY', label: 'JPY' },
  { match: 'SWISS FRANC', asset: 'USDCHF', label: 'CHF' },
  { match: 'CANADIAN DOLLAR', asset: 'USDCAD', label: 'CAD' },
  { match: 'AUSTRALIAN DOLLAR', asset: 'AUDUSD', label: 'AUD' },
  { match: 'BITCOIN', asset: 'BTCUSD', label: 'Bitcoin' },
  { match: 'MICRO BITCOIN', asset: 'BTCUSD_MICRO', label: 'Micro BTC' },
  { match: 'E-MINI S&P 500', asset: 'SPX500', label: 'E-mini S&P' },
  { match: 'E-MINI NASDAQ-100', asset: 'NAS100', label: 'E-mini NQ' },
  { match: 'DJIA', asset: 'DJI', label: 'Dow' },
  { match: 'WHEAT', asset: 'WHEAT', label: 'Wheat' },
  { match: 'CORN', asset: 'CORN', label: 'Corn' },
  { match: 'SOYBEAN', asset: 'SOYBEAN', label: 'Soybean' },
];

async function fetchLatest(matchString, weeks = 8) {
  // Get last N weeks for trend analysis
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=${weeks}&$where=market_and_exchange_names%20like%20%27%25${encodeURIComponent(matchString)}%25%27&$order=report_date_as_yyyy_mm_dd%20DESC`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const arr = await r.json();
    return arr;
  } catch { return null; }
}

function parseRow(row) {
  if (!row) return null;
  const longN = parseInt(row.noncomm_positions_long_all, 10) || 0;
  const shortN = parseInt(row.noncomm_positions_short_all, 10) || 0;
  const spreadN = parseInt(row.noncomm_postions_spread_all || row.noncomm_positions_spread || '0', 10);
  const oi = parseInt(row.open_interest_all, 10) || 0;
  const commLong = parseInt(row.comm_positions_long_all, 10) || 0;
  const commShort = parseInt(row.comm_positions_short_all, 10) || 0;
  const net = longN - shortN;
  const total = longN + shortN;
  const pctLong = total > 0 ? (longN / total) * 100 : 0;
  return {
    date: row.report_date_as_yyyy_mm_dd?.substring(0, 10),
    market: row.contract_market_name,
    open_interest: oi,
    spec_long: longN,
    spec_short: shortN,
    spec_spread: spreadN,
    spec_net: net,
    spec_pct_long: +pctLong.toFixed(1),
    comm_long: commLong,
    comm_short: commShort,
    comm_net: commLong - commShort
  };
}

function buildSignal(history) {
  // history is array of parsed rows, newest first
  if (!history || history.length === 0) return null;
  const cur = history[0];
  const wk1 = history[1];
  const wk4 = history[3];
  const wk8 = history[7];
  // Use 8-week window for percentile of net positioning
  const nets = history.map(h => h.spec_net).filter(n => Number.isFinite(n));
  const min = Math.min(...nets), max = Math.max(...nets);
  const pct = max > min ? ((cur.spec_net - min) / (max - min)) * 100 : 50;
  // Position bias
  let posBias = 'NEUTRAL';
  if (cur.spec_pct_long > 70) posBias = 'CROWDED LONG';
  else if (cur.spec_pct_long < 30) posBias = 'CROWDED SHORT';
  else if (cur.spec_pct_long > 60) posBias = 'NET LONG';
  else if (cur.spec_pct_long < 40) posBias = 'NET SHORT';
  // Trend (week-over-week change)
  const wkChange = wk1 ? cur.spec_net - wk1.spec_net : 0;
  const monthChange = wk4 ? cur.spec_net - wk4.spec_net : 0;
  return {
    bias: posBias,
    spec_net: cur.spec_net,
    pct_long: cur.spec_pct_long,
    week_change: wkChange,
    month_change: monthChange,
    percentile_8w: +pct.toFixed(0),
    extreme: pct > 90 || pct < 10  // flag historical extreme
  };
}

async function run() {
  log('🔄 Fetching COT report...');
  const out = { timestamp: new Date().toISOString(), markets: [] };
  for (const m of MARKETS) {
    const data = await fetchLatest(m.match, 8);
    if (!data || data.length === 0) {
      log(`  ⚠ ${m.label} — no data`);
      continue;
    }
    const history = data.map(parseRow).filter(Boolean);
    const signal = buildSignal(history);
    out.markets.push({
      asset: m.asset,
      label: m.label,
      market: history[0]?.market,
      latest: history[0],
      signal,
      history: history.slice(0, 4)
    });
    await new Promise(r => setTimeout(r, 200));
  }

  // Latest report date
  const dates = out.markets.map(m => m.latest?.date).filter(Boolean);
  out.report_date = dates.sort().reverse()[0];
  out.report_count = out.markets.length;

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`✅ COT ${out.report_count} markets · report ${out.report_date}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  // CFTC publishes weekly Friday; refresh every 6 hours
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 6 * 3600 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

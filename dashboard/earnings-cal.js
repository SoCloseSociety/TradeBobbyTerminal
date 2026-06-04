// ── Earnings Calendar ──
// Pulls upcoming earnings from NASDAQ public API.
// Filters Mag-7 + key macro tickers.
// One-shot: node earnings-cal.js
// Daemon: node earnings-cal.js --daemon

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'earnings_cal.json');
const LOG = join(__dirname, 'earnings-cal.log');
const log = mkLogger(LOG);

// Tickers we actually care about (move markets / index components)
const HIGH_IMPACT = new Set([
  // Mag-7
  'AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','META','TSLA',
  // Banks (financial regime)
  'JPM','BAC','GS','MS','WFC','C',
  // Semis (NAS100 + AI cycle)
  'AVGO','AMD','INTC','TSM','MU','ASML','LRCX','AMAT','QCOM','MRVL','NXPI',
  // Energy giants
  'XOM','CVX','COP','OXY','SLB','EOG','PXD',
  // Tech enterprise / cloud
  'CRM','ORCL','ADBE','NOW','IBM','UBER','PYPL','SNOW',
  // Consumer
  'WMT','HD','COST','MCD','SBUX','NKE','DIS','LULU',
  // Health
  'UNH','PFE','LLY','MRK','JNJ','ABBV',
  // Others (key vol / index mover)
  'NFLX','BA','CAT','GE','BRK.B','BRK.A',
  // Crypto/EV
  'COIN','MSTR','RIOT','MARA','PLTR','RBLX'
]);

const MAG7 = new Set(['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','META','TSLA']);

function fmtDate(d) {
  return d.toISOString().substring(0, 10);
}

async function fetchDate(dateStr) {
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const j = await r.json();
    return j?.data?.rows || [];
  } catch { return []; }
}

async function run() {
  log('🔄 Fetching earnings calendar (next 14 days)...');
  const out = { timestamp: new Date().toISOString(), events: [], mag7: [] };
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const dateStr = fmtDate(d);
    const rows = await fetchDate(dateStr);
    rows.forEach(row => {
      const sym = (row.symbol || '').toUpperCase();
      if (!HIGH_IMPACT.has(sym)) return;
      const event = {
        date: dateStr,
        symbol: sym,
        name: row.name,
        time: row.time,         // time-pre-market | time-after-hours | time-not-supplied
        eps_forecast: row.epsForecast,
        last_year_eps: row.lastYearEPS,
        market_cap: row.marketCap,
        fiscal_q: row.fiscalQuarterEnding,
        impact: MAG7.has(sym) ? 'EXTREME' : 'HIGH',
        is_mag7: MAG7.has(sym)
      };
      out.events.push(event);
      if (MAG7.has(sym)) out.mag7.push(event);
    });
    // Light throttle
    await new Promise(r => setTimeout(r, 250));
  }

  // Sort by date, then time
  out.events.sort((a, b) => a.date.localeCompare(b.date));
  out.mag7.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`✅ ${out.events.length} key earnings · ${out.mag7.length} Mag-7 in next 14 days`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  // Refresh every 12h (calendar doesn't change fast)
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 12 * 3600 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

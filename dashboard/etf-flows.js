// ── ETF Flows Proxy ──
// Tracks BTC ETF + ETH ETF + risk-on/off ETF volume changes as proxy for institutional flows.
// Yahoo Finance free, no auth.
//
// One-shot: node etf-flows.js
// Daemon (every 30min): node etf-flows.js --daemon

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic, readJsonSafe } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'etf_flows.json');
const LOG = join(__dirname, 'etf-flows.log');
const log = mkLogger(LOG);

// Key ETFs grouped by theme
const ETFS = [
  // BTC spot ETFs (BlackRock leads)
  { ticker: 'IBIT', group: 'btc',   label: 'BlackRock BTC',    big_avg: 60_000_000 },
  { ticker: 'FBTC', group: 'btc',   label: 'Fidelity BTC',     big_avg: 8_000_000 },
  { ticker: 'ARKB', group: 'btc',   label: 'ARK BTC',          big_avg: 3_000_000 },
  { ticker: 'BITB', group: 'btc',   label: 'Bitwise BTC',      big_avg: 2_000_000 },
  // ETH spot ETFs
  { ticker: 'ETHA', group: 'eth',   label: 'BlackRock ETH',    big_avg: 5_000_000 },
  { ticker: 'FETH', group: 'eth',   label: 'Fidelity ETH',     big_avg: 1_500_000 },
  // Gold ETFs (institutional flow proxy)
  { ticker: 'GLD',  group: 'gold',  label: 'SPDR Gold',        big_avg: 8_000_000 },
  { ticker: 'IAU',  group: 'gold',  label: 'iShares Gold',     big_avg: 8_000_000 },
  // Silver ETF
  { ticker: 'SLV',  group: 'silver',label: 'iShares Silver',   big_avg: 18_000_000 },
  // Junk vs Treasury (credit risk)
  { ticker: 'HYG',  group: 'credit',label: 'Junk Bonds',       big_avg: 20_000_000 },
  { ticker: 'JNK',  group: 'credit',label: 'Junk Bonds (alt)', big_avg: 4_000_000 },
  { ticker: 'TLT',  group: 'safe',  label: 'Long Treasuries',  big_avg: 30_000_000 },
  // Risk-on / Risk-off
  { ticker: 'ARKK', group: 'riskon',label: 'Innovation',       big_avg: 5_000_000 },
  { ticker: 'IWM',  group: 'riskon',label: 'Small Caps (R2K)', big_avg: 35_000_000 },
  { ticker: 'SMH',  group: 'tech',  label: 'Semis',            big_avg: 6_000_000 },
];

async function fetchETF(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const quotes = j?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!meta || !quotes) return null;
    const closes = (quotes.close || []).filter(Number.isFinite);
    const volumes = (quotes.volume || []).filter(Number.isFinite);
    const last = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    return {
      price: last,
      prev_close: prevClose,
      change_pct: prevClose ? +(((last - prevClose) / prevClose) * 100).toFixed(2) : 0,
      volume_today: volumes[volumes.length - 1] || 0,
      volume_avg_5d: volumes.length > 0 ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0,
      high_5d: closes.length ? Math.max(...closes) : null,
      low_5d: closes.length ? Math.min(...closes) : null
    };
  } catch { return null; }
}

async function run() {
  log('💰 Fetching ETF flows...');
  const out = { timestamp: new Date().toISOString(), etfs: {}, groups: {} };

  for (const e of ETFS) {
    const d = await fetchETF(e.ticker);
    if (d) {
      // Volume relative to expected average → flow intensity
      const flowRatio = e.big_avg > 0 ? +(d.volume_today / e.big_avg).toFixed(2) : 1;
      const flowLabel = flowRatio > 2 ? 'SURGE' : flowRatio > 1.3 ? 'HIGH' : flowRatio > 0.7 ? 'NORMAL' : 'LIGHT';
      out.etfs[e.ticker] = { ...d, label: e.label, group: e.group, flow_ratio: flowRatio, flow_label: flowLabel };
    }
    await new Promise(r => setTimeout(r, 150));
  }

  // Last-known-good merge: keep ETFs from the previous file that failed this cycle,
  // so a transient Yahoo outage never writes "0 ETFs" over good data.
  const prev = readJsonSafe(OUT);
  if (prev?.etfs) {
    let carried = 0;
    for (const e of ETFS) {
      if (!out.etfs[e.ticker] && prev.etfs[e.ticker]) {
        out.etfs[e.ticker] = { ...prev.etfs[e.ticker], stale: true };
        carried++;
      }
    }
    if (carried > 0) log(`  ♻ carried ${carried} ETF(s) from previous run`);
  }

  // Aggregate by group
  for (const e of ETFS) {
    const x = out.etfs[e.ticker];
    if (!x) continue;
    if (!out.groups[e.group]) out.groups[e.group] = { tickers: [], net_change_pct: 0, surges: 0 };
    out.groups[e.group].tickers.push(e.ticker);
    out.groups[e.group].net_change_pct += x.change_pct || 0;
    if (x.flow_label === 'SURGE') out.groups[e.group].surges++;
  }
  Object.keys(out.groups).forEach(g => {
    const n = out.groups[g].tickers.length;
    out.groups[g].avg_change_pct = +(out.groups[g].net_change_pct / n).toFixed(2);
  });

  // Composite institutional flow signal
  const btc = out.groups.btc?.avg_change_pct || 0;
  const eth = out.groups.eth?.avg_change_pct || 0;
  const gold = out.groups.gold?.avg_change_pct || 0;
  const credit = out.groups.credit?.avg_change_pct || 0;
  const safe = out.groups.safe?.avg_change_pct || 0;
  const riskon = out.groups.riskon?.avg_change_pct || 0;

  out.signals = {
    btc_inst_flow: btc > 0.5 ? 'INFLOW' : btc < -0.5 ? 'OUTFLOW' : 'BALANCED',
    eth_inst_flow: eth > 0.5 ? 'INFLOW' : eth < -0.5 ? 'OUTFLOW' : 'BALANCED',
    gold_inst_flow: gold > 0.3 ? 'INFLOW' : gold < -0.3 ? 'OUTFLOW' : 'BALANCED',
    credit_appetite: credit - safe > 0.5 ? 'RISK-ON' : safe - credit > 0.5 ? 'RISK-OFF' : 'NEUTRAL',
    risk_appetite: riskon > 0.5 ? 'GROWTH-BID' : riskon < -0.5 ? 'GROWTH-SOLD' : 'NEUTRAL'
  };

  writeJsonAtomic(OUT, out);
  log(`✅ ${Object.keys(out.etfs).length} ETFs · BTC flow ${out.signals.btc_inst_flow} · credit ${out.signals.credit_appetite}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 30 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

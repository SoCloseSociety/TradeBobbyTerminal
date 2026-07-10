// ── Crypto Pulse ──
// Fetches Fear & Greed Index, BTC dominance, top funding rates from public APIs.
// One-shot: node crypto-pulse.js
// Daemon (every 5min): node crypto-pulse.js --daemon

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'crypto_pulse.json');
const LOG = join(__dirname, 'crypto-pulse.log');
const log = mkLogger(LOG);

async function safeFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fearGreed() {
  const j = await safeFetch('https://api.alternative.me/fng/?limit=8');
  if (!j?.data?.length) return null;
  const items = j.data.map(d => ({
    value: parseInt(d.value, 10),
    classification: d.value_classification,
    timestamp: parseInt(d.timestamp, 10) * 1000
  }));
  const cur = items[0];
  const prev = items[1];
  const week = items[6];
  return {
    current: cur.value,
    classification: cur.classification,
    change_1d: prev ? cur.value - prev.value : 0,
    change_7d: week ? cur.value - week.value : 0,
    history: items
  };
}

async function btcDominance() {
  const j = await safeFetch('https://api.coingecko.com/api/v3/global');
  if (!j?.data) return null;
  return {
    btc_dominance: +(j.data.market_cap_percentage?.btc || 0).toFixed(2),
    eth_dominance: +(j.data.market_cap_percentage?.eth || 0).toFixed(2),
    total_mcap_usd: j.data.total_market_cap?.usd || 0,
    total_volume_usd: j.data.total_volume?.usd || 0,
    mcap_change_24h: +(j.data.market_cap_change_percentage_24h_usd || 0).toFixed(2),
    active_cryptos: j.data.active_cryptocurrencies
  };
}

async function fundingRates() {
  // Binance perpetual funding rates
  const j = await safeFetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  if (!Array.isArray(j)) return null;
  // Filter to common pairs ending in USDT
  const wanted = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','MATICUSDT','ADAUSDT','SUIUSDT','TONUSDT'];
  const map = {};
  j.forEach(t => {
    if (!wanted.includes(t.symbol)) return;
    map[t.symbol] = {
      symbol: t.symbol,
      mark: +t.markPrice,
      index: +t.indexPrice,
      funding: +t.lastFundingRate,
      funding_pct: +(t.lastFundingRate * 100).toFixed(4),
      next_funding: t.nextFundingTime
    };
  });
  // Top 10 by absolute funding (across ALL pairs, then filter wanted)
  const all = j.map(t => ({
    symbol: t.symbol,
    funding: +t.lastFundingRate,
    funding_pct: +(t.lastFundingRate * 100).toFixed(4)
  })).filter(t => t.symbol.endsWith('USDT'));
  const topPos = all.slice().sort((a,b) => b.funding - a.funding).slice(0, 6);
  const topNeg = all.slice().sort((a,b) => a.funding - b.funding).slice(0, 6);
  return { tracked: map, topLong: topPos, topShort: topNeg };
}

async function btcOpenInterest() {
  const j = await safeFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
  if (!j) return null;
  return { symbol: j.symbol, openInterest: +j.openInterest, time: j.time };
}

async function run() {
  log('🔄 Fetching crypto pulse...');
  const [fg, dom, fund, oi] = await Promise.all([
    fearGreed(), btcDominance(), fundingRates(), btcOpenInterest()
  ]);

  const out = {
    timestamp: new Date().toISOString(),
    fear_greed: fg,
    dominance: dom,
    funding: fund,
    open_interest_btc: oi
  };

  // Regime classification
  let regime = 'NEUTRAL', signal = '';
  if (fg) {
    if (fg.current <= 20) { regime = 'EXTREME-FEAR'; signal = 'Contrarian LONG zone (historical bottom)'; }
    else if (fg.current <= 35) { regime = 'FEAR'; signal = 'Accumulation zone'; }
    else if (fg.current <= 50) { regime = 'NEUTRAL'; signal = 'No edge'; }
    else if (fg.current <= 65) { regime = 'GREED'; signal = 'Reduce risk'; }
    else if (fg.current <= 80) { regime = 'GREED-HIGH'; signal = 'Take profit'; }
    else { regime = 'EXTREME-GREED'; signal = 'Contrarian SHORT zone (historical top)'; }
  }
  out.regime = regime;
  out.signal = signal;

  // Funding signal
  const btcF = fund?.tracked?.BTCUSDT?.funding_pct;
  if (btcF !== undefined) {
    if (btcF > 0.05) out.funding_signal = 'BTC longs paying — bullish positioning crowded (squeeze SHORT risk)';
    else if (btcF < -0.02) out.funding_signal = 'BTC shorts paying — bearish positioning crowded (squeeze LONG risk)';
    else out.funding_signal = 'BTC funding balanced';
  }

  writeJsonAtomic(OUT, out);
  log(`✅ F&G ${fg?.current||'—'} (${fg?.classification||''}) · BTC dom ${dom?.btc_dominance||'—'}% · regime ${regime}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 5 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

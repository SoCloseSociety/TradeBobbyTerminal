// ── Bitcoin On-Chain Metrics ──
// blockchain.info + mempool.space free APIs.
// One-shot: node onchain-btc.js
// Daemon: node onchain-btc.js --daemon

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic, readJsonSafe } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'onchain_btc.json');
const LOG = join(__dirname, 'onchain-btc.log');
const log = mkLogger(LOG);

async function txt(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return (await r.text()).trim();
  } catch { return null; }
}
async function json(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Halving: 4th halving was at block 840000 (Apr 2024). Next at 1050000 (~2028).
// Subsidy halves every 210000 blocks.
function halvingInfo(blockHeight) {
  const epoch = Math.floor(blockHeight / 210000);
  const nextHalvingBlock = (epoch + 1) * 210000;
  const blocksToNext = nextHalvingBlock - blockHeight;
  // ~10 min per block average
  const minutesToNext = blocksToNext * 10;
  const daysToNext = +(minutesToNext / (60 * 24)).toFixed(1);
  const currentSubsidy = 50 / Math.pow(2, epoch);  // BTC reward per block
  return { epoch, currentSubsidy, nextHalvingBlock, blocksToNext, daysToNext };
}

async function run() {
  log('🔄 Fetching on-chain BTC...');
  const [hashrate, difficulty, marketcap, totalbc, blockHeight, fees, hashrateHistory, blockTime] = await Promise.all([
    txt('https://blockchain.info/q/hashrate'),
    txt('https://blockchain.info/q/getdifficulty'),
    txt('https://blockchain.info/q/marketcap'),
    txt('https://blockchain.info/q/totalbc'),
    txt('https://blockchain.info/q/getblockcount'),
    json('https://mempool.space/api/v1/fees/recommended'),
    json('https://mempool.space/api/v1/mining/hashrate/3d'),
    txt('https://blockchain.info/q/interval'),  // average block time in seconds
  ]);

  const out = {
    timestamp: new Date().toISOString(),
    hashrate_ghs: hashrate ? parseFloat(hashrate) : null,           // GH/s
    hashrate_ehs: hashrate ? +(parseFloat(hashrate) / 1e9).toFixed(2) : null,  // EH/s = exa
    difficulty: difficulty ? parseFloat(difficulty) : null,
    market_cap_satoshi: marketcap ? parseFloat(marketcap) : null,
    total_btc_satoshis: totalbc ? parseFloat(totalbc) : null,
    total_btc: totalbc ? +(parseFloat(totalbc) / 1e8).toFixed(2) : null,
    block_height: blockHeight ? parseInt(blockHeight, 10) : null,
    avg_block_time_sec: blockTime ? parseFloat(blockTime) : null,
    fees: fees ? {
      fastest_sat_vb: fees.fastestFee,
      half_hour_sat_vb: fees.halfHourFee,
      hour_sat_vb: fees.hourFee,
      economy_sat_vb: fees.economyFee
    } : null,
  };

  // Last-known-good merge: keep previous values for fields that failed this cycle,
  // so a transient API failure never overwrites good data with nulls.
  const FIELDS = ['hashrate_ghs', 'hashrate_ehs', 'difficulty', 'market_cap_satoshi',
    'total_btc_satoshis', 'total_btc', 'block_height', 'avg_block_time_sec', 'fees'];
  const allNull = FIELDS.every(k => out[k] === null || out[k] === undefined);
  const prev = readJsonSafe(OUT);
  if (allNull) {
    log('⚠ All fetches failed — skipping write, keeping previous onchain_btc.json');
    return prev;
  }
  if (prev) {
    let carried = 0;
    for (const k of FIELDS) {
      if ((out[k] === null || out[k] === undefined) && prev[k] !== null && prev[k] !== undefined) {
        out[k] = prev[k];
        carried++;
      }
    }
    if (carried > 0) log(`  ♻ carried ${carried} field(s) from previous run`);
  }

  if (out.block_height) {
    out.halving = halvingInfo(out.block_height);
  }

  // Hashrate trend (3-day window)
  if (hashrateHistory?.hashrates?.length > 0) {
    const recent = hashrateHistory.hashrates.slice(-1)[0]?.avgHashrate;
    const oldest = hashrateHistory.hashrates[0]?.avgHashrate;
    if (recent && oldest) {
      out.hashrate_trend_pct_3d = +(((recent - oldest) / oldest) * 100).toFixed(2);
    }
  } else if (prev?.hashrate_trend_pct_3d !== undefined) {
    out.hashrate_trend_pct_3d = prev.hashrate_trend_pct_3d;
  }

  // Network state classification
  if (out.fees) {
    if (out.fees.fastest_sat_vb > 100) out.fee_state = 'CONGESTED';
    else if (out.fees.fastest_sat_vb > 30) out.fee_state = 'BUSY';
    else if (out.fees.fastest_sat_vb > 10) out.fee_state = 'NORMAL';
    else out.fee_state = 'CALM';
  }

  writeJsonAtomic(OUT, out);
  log(`✅ Block ${out.block_height} · Hashrate ${out.hashrate_ehs} EH/s · Halving in ${out.halving?.daysToNext}d · Fees ${out.fee_state}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 10 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

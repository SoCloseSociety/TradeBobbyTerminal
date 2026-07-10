// ── Macro Context ──
// Regenerates macro_context.json from the LIVE data files kept fresh by the other daemons:
//   macro_pulse.json (DXY, VIX regime, yield curve), cot.json (COT positioning),
//   news_feed.json (sentiment, risk_off, critical triggers), crypto_pulse.json (F&G, funding).
// Mechanical, evidence-lean rules only -- no AI, no web calls.
// Consumers (do NOT break):
//   - server.js renderMacroBias(): geopolitical.{wars,trade_wars,sanctions}[].{name,bias},
//     institutional.{gold,silver,oil}.bias (string containing LONG/BULL/SHORT/BEAR, weight 2),
//     last_updated, priority_alerts[]
//   - generate-setups.js: checks macro?.institutional truthiness only
// Fields we cannot derive mechanically (geopolitical narrative, institutional facts,
// macro_rules) are carried from the previous file and marked carried: true.
// One-shot: node macro-context.js
// Daemon (every 30min): node macro-context.js --daemon

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic, readJsonSafe } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'macro_context.json');
const LOG = join(__dirname, 'macro-context.log');
const log = mkLogger(LOG);

// Freshness gates (ms). Stale inputs are ignored, not trusted.
const FRESH = {
  pulse: 24 * 3600e3,   // macro_pulse refreshes every 5min; 24h = generous
  news_sent: 6 * 3600e3, // sentiment decays fast
  news_trig: 48 * 3600e3, // geo triggers stay relevant a couple days
  crypto: 24 * 3600e3,
  cot_days: 21,          // COT report is weekly; ignore if older than 3 weeks
};

// Asset rule table.
//   usd: 'inverse' = USD up hurts the asset (commodities, EURUSD/GBPUSD); 'direct' = USD up helps (USDJPY)
//   cot: asset key in cot.json markets[]; cotInvert: COT is on the foreign currency future (JPY),
//        so spec net short JPY = bullish USDJPY
//   newsKey: key in news_feed.json sentiment{}
const ASSETS = {
  XAUUSD: { usd: 'inverse', kind: 'safe_haven', cot: 'XAUUSD', newsKey: 'gold' },
  XAGUSD: { usd: 'inverse', kind: 'commodity', cot: 'XAGUSD', newsKey: 'silver' },
  USOIL:  { usd: 'inverse', kind: 'commodity', cot: 'USOIL', newsKey: 'oil' },
  EURUSD: { usd: 'inverse', kind: 'fx', cot: 'EURUSD' },
  GBPUSD: { usd: 'inverse', kind: 'fx', cot: 'GBPUSD' },
  USDJPY: { usd: 'direct', kind: 'fx', cot: 'USDJPY', cotInvert: true },
  NAS100: { kind: 'index', cot: 'NAS100' },
  SPX500: { kind: 'index', cot: 'SPX500' },
  US30:   { kind: 'index', cot: 'DJI' },
  BTCUSD: { kind: 'crypto', cot: 'BTCUSD' },
};

const ageMs = (ts) => ts ? Date.now() - new Date(ts).getTime() : Infinity;

function deriveAssets({ pulse, cot, news, crypto }) {
  const pulseFresh = pulse && ageMs(pulse.timestamp) < FRESH.pulse;
  const newsFresh = news && ageMs(news.timestamp) < FRESH.news_sent;
  const cryptoFresh = crypto && ageMs(crypto.timestamp) < FRESH.crypto;
  const cotFresh = cot?.report_date &&
    (Date.now() - new Date(cot.report_date).getTime()) < FRESH.cot_days * 86400e3;

  const dxyChg = pulseFresh ? (pulse.data?.dxy?.changePct ?? null) : null;
  // USD direction: needs a real intraday move, not noise
  const usdDir = dxyChg === null ? 0 : dxyChg > 0.15 ? 1 : dxyChg < -0.15 ? -1 : 0;
  const volRegime = pulseFresh ? (pulse.regime?.vol ?? 'unknown') : 'unknown';
  const curve = pulseFresh ? (pulse.regime?.yield_curve ?? null) : null;
  const riskOff = newsFresh ? (news.sentiment?.risk_off?.level ?? null) : null;
  const cotByAsset = {};
  if (cotFresh) for (const m of (cot.markets || [])) cotByAsset[m.asset] = m.signal;

  const assets = {};
  for (const [sym, def] of Object.entries(ASSETS)) {
    let score = 0;
    const notes = [];

    // 1) DXY direction (only assets with a USD linkage)
    if (def.usd && usdDir !== 0) {
      const eff = def.usd === 'inverse' ? -usdDir : usdDir;
      score += eff;
      notes.push(`DXY ${usdDir > 0 ? 'up' : 'down'} ${dxyChg.toFixed(2)}% (${eff > 0 ? '+1' : '-1'})`);
    }

    // 2) VIX volatility regime
    if (volRegime !== 'unknown') {
      if (def.kind === 'index') {
        if (['HIGH', 'EXTREME'].includes(volRegime)) { score -= 2; notes.push(`VIX ${volRegime} (-2)`); }
        else if (volRegime === 'ELEVATED') { score -= 1; notes.push('VIX ELEVATED (-1)'); }
        else if (volRegime === 'COMPLACENT') { score += 1; notes.push('VIX COMPLACENT (+1)'); }
      } else if (def.kind === 'crypto' && ['HIGH', 'EXTREME'].includes(volRegime)) {
        score -= 1; notes.push(`VIX ${volRegime}: crypto first to crash (-1)`);
      } else if (def.kind === 'safe_haven' && ['HIGH', 'EXTREME'].includes(volRegime)) {
        score += 1; notes.push(`VIX ${volRegime}: safe-haven demand (+1)`);
      }
    }

    // 3) Yield curve state
    if (curve === 'INVERTED') {
      if (def.kind === 'index') { score -= 1; notes.push('Yield curve INVERTED (-1)'); }
      if (def.kind === 'safe_haven') { score += 1; notes.push('Yield curve INVERTED (+1)'); }
    }

    // 4) COT spec net positioning (direction of the specs, inverted for JPY-quoted future)
    const sig = def.cot ? cotByAsset[def.cot] : null;
    if (sig && typeof sig.spec_net === 'number' && sig.spec_net !== 0) {
      let dir = sig.spec_net > 0 ? 1 : -1;
      if (def.cotInvert) dir = -dir;
      score += dir;
      notes.push(`COT spec ${sig.spec_net > 0 ? 'net long' : 'net short'} ${sig.spec_net}${def.cotInvert ? ' (currency future, inverted)' : ''} (${dir > 0 ? '+1' : '-1'})`);
      if (sig.extreme && (sig.pct_long >= 75 || sig.pct_long <= 25)) {
        notes.push(`COT crowding extreme (pct_long ${sig.pct_long}) -- contrarian caution, not scored`);
      }
    }

    // 5) News risk_off level
    if (riskOff === 'HIGH') {
      if (def.kind === 'index' || def.kind === 'crypto') { score -= 1; notes.push('News risk-off HIGH (-1)'); }
      if (def.kind === 'safe_haven') { score += 1; notes.push('News risk-off HIGH (+1)'); }
    }

    // 6) News sentiment for commodities (fresh only)
    if (newsFresh && def.newsKey) {
      const s = news.sentiment?.[def.newsKey];
      if (s?.bias === 'BULLISH') { score += 1; notes.push(`News ${def.newsKey} BULLISH (+1)`); }
      else if (s?.bias === 'BEARISH') { score -= 1; notes.push(`News ${def.newsKey} BEARISH (-1)`); }
    }

    // 7) Crypto-only extras: funding crowding + F&G context
    if (def.kind === 'crypto' && cryptoFresh) {
      const f = crypto.funding?.tracked?.BTCUSDT?.funding_pct;
      if (typeof f === 'number' && f >= 0.05) { score -= 1; notes.push(`BTC funding ${f}% crowded longs (-1)`); }
      const fg = crypto.fear_greed?.current;
      if (typeof fg === 'number') notes.push(`F&G ${fg} (${crypto.fear_greed.classification}) -- context only`);
    }

    const net = score > 0 ? 'LONG' : score < 0 ? 'SHORT' : 'NEUTRAL';
    assets[sym] = { net, score, notes };
  }

  return {
    assets,
    inputs: {
      dxy_change_pct: dxyChg,
      vol_regime: volRegime,
      yield_curve: curve,
      risk_off: riskOff,
      cot_report_date: cotFresh ? cot.report_date : null,
      pulse_fresh: !!pulseFresh, news_fresh: !!newsFresh,
      cot_fresh: !!cotFresh, crypto_fresh: !!cryptoFresh,
    },
  };
}

// Institutional bias strings are consumed by the dashboard with weight 2:
// they must contain LONG/BULL or SHORT/BEAR only when directional.
function biasString(a) {
  if (!a) return 'NEUTRAL -- no data';
  if (a.score > 0) return `LONG bias (score +${a.score}: ${a.notes.filter(n => n.includes('+')).map(n => n.split(' (')[0]).join(', ') || 'derived'})`;
  if (a.score < 0) return `SHORT bias (score ${a.score}: ${a.notes.filter(n => n.includes('-1') || n.includes('-2')).map(n => n.split(' (')[0]).join(', ') || 'derived'})`;
  return 'NEUTRAL -- mixed signals';
}

function buildAlerts({ pulse, cot, news }, derived) {
  const alerts = [];
  const { vol_regime, yield_curve } = derived.inputs;
  if (['ELEVATED', 'HIGH', 'EXTREME'].includes(vol_regime)) alerts.push(`VIX regime ${vol_regime} (${pulse?.regime?.vix ?? '?'}) -- size down`);
  if (yield_curve === 'INVERTED') alerts.push('Yield curve INVERTED -- recession signal active');
  // COT extremes on watch assets
  if (derived.inputs.cot_fresh) {
    for (const m of (cot.markets || [])) {
      if (!ASSETS[m.asset] && m.asset !== 'DJI') continue;
      const s = m.signal || {};
      if (s.extreme && (s.pct_long >= 75 || s.pct_long <= 25)) {
        alerts.push(`COT ${m.label}: ${s.bias} extreme (pct_long ${s.pct_long})`);
      }
    }
  }
  // Live HIGH-impact geo triggers from the news scanner
  if (news && ageMs(news.timestamp) < FRESH.news_trig) {
    const seen = new Set();
    for (const t of (news.critical_triggers || [])) {
      if (t.impact !== 'HIGH' || seen.has(t.trigger)) continue;
      seen.add(t.trigger);
      alerts.push(`${t.trigger.toUpperCase()} [${(t.assets || []).join('/')}]: ${(t.title || '').slice(0, 90)}`);
      if (seen.size >= 3) break;
    }
  }
  return alerts.slice(0, 8);
}

function run() {
  log('🔄 Rebuilding macro context...');
  const src = {
    pulse: readJsonSafe(join(__dirname, 'macro_pulse.json')),
    cot: readJsonSafe(join(__dirname, 'cot.json')),
    news: readJsonSafe(join(__dirname, 'news_feed.json')),
    crypto: readJsonSafe(join(__dirname, 'crypto_pulse.json')),
  };
  const prev = readJsonSafe(OUT, {});
  const derived = deriveAssets(src);
  const now = new Date();

  // Carry non-derivable narrative sections from the previous file, marked carried: true.
  const carry = (arr) => (Array.isArray(arr) ? arr : []).map(x => ({ ...x, carried: true }));
  const geopolitical = {
    wars: carry(prev.geopolitical?.wars),
    trade_wars: carry(prev.geopolitical?.trade_wars),
    sanctions: carry(prev.geopolitical?.sanctions),
  };

  // Institutional: derive the consumed .bias strings; carry the factual context fields.
  const instPrev = prev.institutional || {};
  const instAsset = { gold: 'XAUUSD', silver: 'XAGUSD', oil: 'USOIL' };
  const institutional = {};
  for (const [k, sym] of Object.entries(instAsset)) {
    const { bias: _oldBias, carried: _c, ...carriedFields } = instPrev[k] || {};
    institutional[k] = {
      ...carriedFields,
      ...(Object.keys(carriedFields).length ? { carried: true } : {}),
      bias: biasString(derived.assets[sym]),
      bias_derived_from: 'macro-context.js mechanical rules',
    };
  }

  const macro_rules = prev.macro_rules
    ? { ...prev.macro_rules, carried: true }
    : { indices_follow: 'DXY (dollar index)', crypto_is: 'risk-on extreme, first to crash', carried: false };

  const out = {
    last_updated: now.toISOString().slice(0, 10),
    updated: now.toISOString(),
    generated_by: 'macro-context.js (mechanical synthesis, no AI)',
    sources: {
      macro_pulse: src.pulse?.timestamp || null,
      cot: src.cot?.timestamp || null,
      news_feed: src.news?.timestamp || null,
      crypto_pulse: src.crypto?.timestamp || null,
    },
    assets: derived.assets,
    inputs: derived.inputs,
    geopolitical,
    institutional,
    macro_rules,
    priority_alerts: buildAlerts(src, derived),
  };

  writeJsonAtomic(OUT, out);
  const summary = Object.entries(derived.assets)
    .filter(([, a]) => a.score !== 0)
    .map(([s, a]) => `${s} ${a.score > 0 ? '+' : ''}${a.score}`)
    .join(' ');
  log(`✅ Wrote macro_context: ${Object.keys(derived.assets).length} assets · ${summary || 'all neutral'} · vol=${derived.inputs.vol_regime} · risk_off=${derived.inputs.risk_off ?? 'n/a'} · alerts=${out.priority_alerts.length}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  const safe = () => { try { run(); } catch (e) { log('❌ ' + e.message); } };
  safe();
  setInterval(safe, 30 * 60 * 1000);
} else {
  try { run(); } catch (e) { log('❌ ' + e.message); process.exit(1); }
}

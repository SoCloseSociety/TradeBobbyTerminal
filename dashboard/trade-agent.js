// ── Trade Agent (Synthesis Engine) ──
// Reads ALL data sources, detects convergences/divergences, outputs structured brief.
// One-shot: node trade-agent.js
// Daemon (every 15min): node trade-agent.js --daemon

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'trade_brief.json');
const MD_OUT = join(__dirname, 'daily_brief.md');
const LOG = join(__dirname, 'trade-agent.log');
const log = mkLogger(LOG);

function readJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function isBullish(s) { return s && (s.includes('BULL') || s.includes('📈') || s.includes('🟢')); }
function isBearish(s) { return s && (s.includes('BEAR') || s.includes('📉') || s.includes('🔴')); }

// ── DATA LOADERS ──
function loadAll() {
  return {
    scan:       readJSON(join(__dirname, 'last_scan.json')) || { symbols: [] },
    setups:     readJSON(join(__dirname, 'live_setups.json')) || { setups: [] },
    macro:      readJSON(join(__dirname, 'macro_pulse.json')) || { data: {}, regime: {} },
    crypto:     readJSON(join(__dirname, 'crypto_pulse.json')) || {},
    news:       readJSON(join(__dirname, 'news_feed.json')) || { items: [], sentiment: {}, critical_triggers: [] },
    cot:        readJSON(join(__dirname, 'cot.json')) || { markets: [] },
    macroCtx:   readJSON(join(__dirname, 'macro_context.json')) || {},
    currency:   readJSON(join(__dirname, 'currency_strength.json')) || { ranking: [] },
    onchain:    readJSON(join(__dirname, 'onchain_btc.json')) || {},
    reddit:     readJSON(join(__dirname, 'reddit_mania.json')) || { top_tickers: [] },
    calendar:   readJSON(join(__dirname, 'econ_calendar.json')) || { events: [] },
    earnings:   readJSON(join(__dirname, 'earnings_cal.json')) || { events: [] },
    setupStats: readJSON(join(__dirname, 'setup_stats.json')) || {},
  };
}

// ── COMPOSITE RISK INDEX (0-100, 50 = neutral) ──
function riskIndex(d) {
  // 0-30 = panic/fear, 30-45 = cautious, 45-55 = neutral, 55-70 = optimistic, 70-85 = greedy, 85-100 = euphoric
  let score = 50;
  const components = [];

  // VIX (15-25 normal range, inverted)
  const vix = d.macro.data.vix?.price;
  if (vix !== undefined) {
    if (vix < 12) { score += 18; components.push({ k:'VIX', v:vix, contrib:'+18 (extremely complacent)' }); }
    else if (vix < 15) { score += 12; components.push({ k:'VIX', v:vix, contrib:'+12 (complacent)' }); }
    else if (vix < 20) { score += 6; components.push({ k:'VIX', v:vix, contrib:'+6 (normal)' }); }
    else if (vix < 25) { score -= 5; components.push({ k:'VIX', v:vix, contrib:'-5 (elevated)' }); }
    else if (vix < 35) { score -= 15; components.push({ k:'VIX', v:vix, contrib:'-15 (high stress)' }); }
    else { score -= 25; components.push({ k:'VIX', v:vix, contrib:'-25 (extreme panic)' }); }
  }
  // VIX term structure
  const ts = d.macro.regime?.vix_term_state;
  if (ts === 'CONTANGO_DEEP') { score += 8; components.push({ k:'VIX-TERM', v:ts, contrib:'+8 (deep contango)' }); }
  else if (ts === 'CONTANGO') { score += 2; components.push({ k:'VIX-TERM', v:ts, contrib:'+2' }); }
  else if (ts === 'BACKWARDATION') { score -= 12; components.push({ k:'VIX-TERM', v:ts, contrib:'-12 (backwardation)' }); }

  // Yield curve
  const yc = d.macro.regime?.yield_curve;
  if (yc === 'INVERTED') { score -= 10; components.push({ k:'YIELD-CURVE', v:yc, contrib:'-10 (recession signal)' }); }
  else if (yc === 'FLAT') { score -= 4; components.push({ k:'YIELD-CURVE', v:yc, contrib:'-4 (flat)' }); }
  else if (yc === 'NORMAL') { score += 3; components.push({ k:'YIELD-CURVE', v:yc, contrib:'+3 (normal)' }); }

  // Sector rotation (already computed)
  const sr = d.macro.sector_rotation;
  if (sr) {
    const delta = sr.risk_on_score - sr.risk_off_score;
    const adj = Math.max(-12, Math.min(12, delta * 4));
    score += adj;
    components.push({ k:'SECTOR-ROT', v:delta.toFixed(2), contrib: (adj>=0?'+':'')+adj.toFixed(1) });
  }

  // Credit (HYG/IEF) — high ratio = risk-on
  const credit = d.macro.regime?.credit_ratio_hyg_ief;
  if (credit !== undefined) {
    if (credit > 1.0) { score += 5; components.push({ k:'CREDIT', v:credit, contrib:'+5 (junk strong)' }); }
    else if (credit < 0.85) { score -= 5; components.push({ k:'CREDIT', v:credit, contrib:'-5 (credit stress)' }); }
  }

  // News risk-off
  const ro = d.news.sentiment?.risk_off?.level;
  if (ro === 'HIGH') { score -= 15; components.push({ k:'NEWS-RISKOFF', v:ro, contrib:'-15' }); }
  else if (ro === 'ELEVATED') { score -= 8; components.push({ k:'NEWS-RISKOFF', v:ro, contrib:'-8' }); }

  // Critical triggers
  const trigs = (d.news.critical_triggers || []);
  const extreme = trigs.filter(t => t.impact === 'EXTREME').length;
  const high = trigs.filter(t => t.impact === 'HIGH').length;
  if (extreme > 0) { score -= Math.min(15, extreme * 5); components.push({ k:'TRIGGERS', v:extreme+'EX/'+high+'HI', contrib:'-' + Math.min(15, extreme * 5) }); }
  else if (high > 5) { score -= 5; components.push({ k:'TRIGGERS', v:high+'HI', contrib:'-5' }); }

  // Crypto F&G — but contrarian: extreme fear actually = risk-on opportunity historically
  const fg = d.crypto.fear_greed?.current;
  if (fg !== undefined) {
    if (fg <= 15) { score -= 8; components.push({ k:'F&G', v:fg, contrib:'-8 (extreme crypto fear)' }); }
    else if (fg <= 30) { score -= 3; components.push({ k:'F&G', v:fg, contrib:'-3 (fear)' }); }
    else if (fg >= 80) { score += 5; components.push({ k:'F&G', v:fg, contrib:'+5 (greed peak — risky)' }); }
    else if (fg >= 65) { score += 3; components.push({ k:'F&G', v:fg, contrib:'+3 (greed)' }); }
  }

  // Reddit retail mania — high mania = risk peak (contrarian flag)
  const mania = d.reddit.mania_level;
  if (mania === 'EXTREME') { score += 4; components.push({ k:'RETAIL', v:mania, contrib:'+4 (mania peak)' }); }
  else if (mania === 'ELEVATED') { score += 2; components.push({ k:'RETAIL', v:mania, contrib:'+2' }); }

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Classification
  let label, color;
  if (score < 20) { label = 'PANIC';        color = 'red'; }
  else if (score < 35) { label = 'FEAR';     color = 'red'; }
  else if (score < 45) { label = 'CAUTIOUS'; color = 'orange'; }
  else if (score < 55) { label = 'NEUTRAL';  color = 'yellow'; }
  else if (score < 65) { label = 'OPTIMISTIC';color = 'green'; }
  else if (score < 80) { label = 'GREED';    color = 'green'; }
  else if (score < 90) { label = 'EUPHORIC'; color = 'amber'; }
  else                 { label = 'EXTREME GREED'; color = 'red'; }  // contrarian top warning

  return { score, label, color, components };
}

// ── REGIME CLASSIFICATION ──
function classifyRegime(d) {
  const reasons = [];
  let onScore = 0, offScore = 0;
  // VIX
  const vix = d.macro.data.vix?.price;
  if (vix !== undefined) {
    if (vix < 15) { onScore += 2; reasons.push('VIX<15 (complacent)'); }
    else if (vix < 20) { onScore += 1; reasons.push(`VIX ${vix} normal`); }
    else if (vix < 25) { offScore += 1; reasons.push(`VIX ${vix} elevated`); }
    else { offScore += 2; reasons.push(`VIX ${vix} stress`); }
  }
  // VIX term
  if (d.macro.regime?.vix_term_state) {
    const ts = d.macro.regime.vix_term_state;
    if (ts === 'BACKWARDATION') { offScore += 2; reasons.push('VIX backwardation = front-month panic'); }
    else if (ts === 'CONTANGO_DEEP') { onScore += 2; reasons.push('VIX deep contango = institutionals calm'); }
  }
  // Yield curve
  if (d.macro.regime?.yield_curve === 'INVERTED') {
    offScore += 1; reasons.push('Yield curve INVERTED = recession signal');
  }
  // Sector rotation
  const sr = d.macro.sector_rotation;
  if (sr) {
    if (sr.risk_on_score > sr.risk_off_score + 0.5) { onScore += 2; reasons.push(`Sector rotation RISK-ON (${sr.risk_on_score.toFixed(2)} vs ${sr.risk_off_score.toFixed(2)})`); }
    else if (sr.risk_off_score > sr.risk_on_score + 0.5) { offScore += 2; reasons.push(`Sector rotation RISK-OFF`); }
  }
  // News risk-off
  const ro = d.news.sentiment?.risk_off;
  if (ro) {
    if (ro.level === 'HIGH') { offScore += 2; reasons.push('News risk-off HIGH'); }
    else if (ro.level === 'ELEVATED') { offScore += 1; reasons.push('News risk-off elevated'); }
  }
  // Crypto F&G
  const fg = d.crypto.fear_greed?.current;
  if (fg !== undefined) {
    if (fg <= 20) { offScore += 1; reasons.push(`Crypto F&G ${fg} extreme fear`); }
    else if (fg >= 80) { offScore += 1; reasons.push(`Crypto F&G ${fg} extreme greed = top risk`); }
  }
  // Total
  const verdict = onScore > offScore + 1 ? 'RISK-ON' : offScore > onScore + 1 ? 'RISK-OFF' : 'MIXED';
  const confidence = Math.abs(onScore - offScore);
  return { verdict, on_score: onScore, off_score: offScore, confidence, reasons };
}

// ── CONFLICT/DIVERGENCE DETECTION ──
function findDivergences(d) {
  const divs = [];
  // News narrative vs market price (gold/oil divergence)
  const goldS = d.news.sentiment?.gold?.bias;
  const oilS = d.news.sentiment?.oil?.bias;
  const xau = d.scan.symbols?.find(s => s.symbol === 'XAUUSD');
  const oil = d.scan.symbols?.find(s => s.symbol === 'USOIL');
  if (xau) {
    const htf = xau.tf_240?.['HTF (D)'] || xau.tf_240?.HTF || '';
    if (goldS === 'BULLISH' && isBearish(htf)) divs.push({ kind:'NEWS_VS_PRICE', asset:'XAUUSD', detail:'News bullish gold but HTF bearish — narrative > price = potential reversal incoming OR price ignoring news' });
    if (goldS === 'BEARISH' && isBullish(htf)) divs.push({ kind:'NEWS_VS_PRICE', asset:'XAUUSD', detail:'News bearish gold but HTF bullish — smart money buying weakness' });
  }
  if (oil) {
    const htf = oil.tf_240?.['HTF (D)'] || oil.tf_240?.HTF || '';
    if (oilS === 'BULLISH' && isBearish(htf)) divs.push({ kind:'NEWS_VS_PRICE', asset:'USOIL', detail:'News bullish oil but HTF bearish — fade headlines' });
  }

  // COT extreme vs setup direction
  for (const m of (d.cot.markets || [])) {
    const sig = m.signal;
    if (!sig?.extreme) continue;
    const sym = m.asset;
    const live = (d.setups.setups || []).find(s => s.symbol === sym);
    if (live) {
      const speccsLong = sig.bias.includes('CROWDED LONG');
      if (speccsLong && live.direction === 'LONG') divs.push({ kind:'COT_CROWDED', asset:sym, detail:`Setup says LONG but COT pctile ${sig.percentile_8w} = specs already crowded long — risk of reversal` });
      if (sig.bias.includes('CROWDED SHORT') && live.direction === 'SHORT') divs.push({ kind:'COT_CROWDED', asset:sym, detail:`Setup says SHORT but COT pctile ${sig.percentile_8w} = specs already crowded short — squeeze risk` });
    }
  }

  // VIX deep contango but news triggers HIGH (institutionnel calm vs retail/news panic)
  if (d.macro.regime?.vix_term_state === 'CONTANGO_DEEP' && (d.news.critical_triggers || []).length > 5) {
    divs.push({ kind:'VIX_VS_NEWS', asset:'GLOBAL', detail:`VIX deep contango but ${d.news.critical_triggers.length} active news triggers — institutionnels ignore the noise` });
  }

  // Reddit retail crowded vs sector
  const topRetail = (d.reddit.top_tickers || []).slice(0, 3);
  if (topRetail.length > 0 && topRetail[0].mentions > 8) {
    divs.push({ kind:'RETAIL_CROWD', asset:topRetail[0].ticker, detail:`Retail spike on ${topRetail[0].ticker} (${topRetail[0].mentions} mentions) — contrarian risk` });
  }

  return divs;
}

// ── TRADE IDEA GENERATION ──
function generateIdeas(d, regime) {
  const ideas = [];

  // 1. V5 Setups (already filtered) → boost score with macro alignment
  for (const s of (d.setups.setups || [])) {
    let score = s.score || 0;
    const reasons = [...(s.reasons || [])];
    const flags = [];

    // Regime alignment
    if (regime.verdict === 'RISK-ON' && ['SPX500','NAS100','DAX','BTCUSD','ETHUSD'].includes(s.symbol)) {
      if (s.direction === 'LONG') { score += 2; reasons.push('Regime RISK-ON aligns with LONG'); }
      else { score -= 1; }
    }
    if (regime.verdict === 'RISK-OFF' && ['XAUUSD','XAGUSD'].includes(s.symbol)) {
      if (s.direction === 'LONG') { score += 2; reasons.push('Regime RISK-OFF favors safe haven LONG'); }
    }

    // COT alignment
    const cot = (d.cot.markets || []).find(m => m.asset === s.symbol);
    if (cot?.signal) {
      const sig = cot.signal;
      const crowdedLong = sig.bias.includes('CROWDED LONG');
      const crowdedShort = sig.bias.includes('CROWDED SHORT');
      if (s.direction === 'LONG' && crowdedShort) { score += 2; reasons.push(`COT specs short crowded (pctile ${sig.percentile_8w}) → squeeze edge`); }
      if (s.direction === 'SHORT' && crowdedLong) { score += 2; reasons.push(`COT specs long crowded (pctile ${sig.percentile_8w}) → reversal edge`); }
      if (s.direction === 'LONG' && crowdedLong) { score -= 1; flags.push('COT crowded same direction'); }
      if (s.direction === 'SHORT' && crowdedShort) { score -= 1; flags.push('COT crowded same direction'); }
    }

    // News bias alignment
    const newsBias = {
      'XAUUSD': d.news.sentiment?.gold?.bias,
      'XAGUSD': d.news.sentiment?.silver?.bias,
      'USOIL': d.news.sentiment?.oil?.bias,
      'UKOIL': d.news.sentiment?.oil?.bias
    }[s.symbol];
    if (newsBias === 'BULLISH' && s.direction === 'LONG') { score += 1; reasons.push('News sentiment bullish'); }
    if (newsBias === 'BEARISH' && s.direction === 'SHORT') { score += 1; reasons.push('News sentiment bearish'); }

    // Macro context bias
    const mctxBias = (() => {
      const arr = [];
      ['wars','trade_wars','sanctions'].forEach(k => {
        (d.macroCtx?.geopolitical?.[k] || []).forEach(item => {
          if (item.bias && item.bias[s.symbol]) arr.push(item.bias[s.symbol]);
        });
      });
      const longs = arr.filter(x => x === 'LONG').length;
      const shorts = arr.filter(x => x === 'SHORT').length;
      return longs > shorts ? 'LONG' : shorts > longs ? 'SHORT' : 'NEUTRAL';
    })();
    if (mctxBias !== 'NEUTRAL' && mctxBias === s.direction) {
      score += 1; reasons.push(`Macro context bias ${mctxBias}`);
    }

    // Currency strength alignment for FX
    const fxBase = { 'EURUSD': ['EUR','USD'], 'GBPUSD':['GBP','USD'], 'USDJPY':['USD','JPY'], 'GBPJPY':['GBP','JPY'] }[s.symbol];
    if (fxBase) {
      const [base, quote] = fxBase;
      const baseS = d.currency.strength?.[base] || 0;
      const quoteS = d.currency.strength?.[quote] || 0;
      const expectedDir = baseS > quoteS ? 'LONG' : 'SHORT';
      if (expectedDir === s.direction) { score += 1; reasons.push(`Currency strength ${base}(${baseS}) vs ${quote}(${quoteS}) confirms`); }
      else flags.push(`Currency strength suggests opposite direction (${expectedDir})`);
    }

    // Setup tracker historical WR
    const symStat = d.setupStats?.by_symbol?.[s.symbol];
    if (symStat && symStat.total >= 3) {
      if (symStat.win_rate >= 60) { score += 1; reasons.push(`Historical WR ${symStat.win_rate}% on ${s.symbol}`); }
      else if (symStat.win_rate <= 40) { score -= 1; flags.push(`Low historical WR ${symStat.win_rate}% on ${s.symbol}`); }
    }

    const grade = score >= 8 ? 'A+' : score >= 6 ? 'A' : score >= 4 ? 'B' : 'C';
    ideas.push({
      symbol: s.symbol,
      direction: s.direction,
      entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2,
      rr: s.rr,
      original_score: s.score,
      synthesis_score: score,
      grade,
      reasons,
      flags,
      original_quality: s.quality,
      source: 'V5_SCAN'
    });
  }

  // 2. Macro-based ideas (if no V5 setups, propose from macro alone)
  if (ideas.length === 0) {
    // Currency strength FX idea
    if (d.currency.best_pair) {
      const bp = d.currency.best_pair;
      ideas.push({
        symbol: bp.pair,
        direction: bp.direction,
        entry: null, sl: null, tp1: null, tp2: null,
        rr: null,
        synthesis_score: 4,
        grade: 'B',
        reasons: ['Currency strength: ' + bp.rationale, 'Macro-only idea (no V5 setup live)'],
        flags: ['No structural setup, requires manual entry confirmation'],
        source: 'CURRENCY_STRENGTH'
      });
    }
    // COT extreme contrarian
    (d.cot.markets || []).filter(m => m.signal?.extreme).forEach(m => {
      const sig = m.signal;
      const dir = sig.bias.includes('CROWDED LONG') ? 'SHORT' : sig.bias.includes('CROWDED SHORT') ? 'LONG' : null;
      if (!dir) return;
      ideas.push({
        symbol: m.asset,
        direction: dir,
        entry: null, sl: null, tp1: null, tp2: null,
        rr: null,
        synthesis_score: 5,
        grade: 'B',
        reasons: [`COT pctile ${sig.percentile_8w} = ${sig.bias} → contrarian ${dir}`, `Spec %long ${sig.pct_long}, week chg ${sig.week_change}`],
        flags: ['Contrarian play needs structural trigger; wait for CHoCH'],
        source: 'COT_EXTREME'
      });
    });
  }

  // Sort by synthesis_score
  ideas.sort((a, b) => b.synthesis_score - a.synthesis_score);
  return ideas;
}

// ── UPCOMING RISK CATALYSTS ──
function listCatalysts(d) {
  const now = new Date();
  const horizon = now.getTime() + 7 * 86400000;
  const events = (d.calendar.events || [])
    .filter(e => {
      const dt = new Date(e.datetime).getTime();
      return dt > now.getTime() && dt < horizon;
    })
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const earnings = (d.earnings.events || [])
    .filter(e => {
      const dt = new Date(e.date + 'T15:00:00Z').getTime();
      return dt > now.getTime() && dt < horizon;
    });
  return { econ: events.slice(0, 6), earnings: earnings.slice(0, 8) };
}

// ── TOP TRIGGERS / ACTION ITEMS ──
function actionItems(d, regime, ideas, divs) {
  const items = [];
  // Critical news triggers
  const trigs = d.news.critical_triggers || [];
  const extreme = trigs.filter(t => t.impact === 'EXTREME');
  if (extreme.length > 0) items.push(`🔴 ${extreme.length} EXTREME triggers active: ${[...new Set(extreme.map(t => t.trigger))].join(', ')}`);

  // Catalysts within 12h
  const now = new Date();
  const next12h = (d.calendar.events || []).filter(e => {
    const dt = new Date(e.datetime);
    const dh = (dt - now) / 3600000;
    return dh > 0 && dh < 12 && e.impact === 'HIGH';
  });
  if (next12h.length > 0) items.push(`⏱ ${next12h.length} HIGH-impact event(s) in next 12h: ${next12h.map(e => e.name).join(', ')}`);

  // Best idea
  const top = ideas[0];
  if (top) items.push(`🎯 Top idea: ${top.grade} ${top.direction} ${top.symbol} (score ${top.synthesis_score})`);

  // Regime
  items.push(`📊 Regime: ${regime.verdict} (confidence ${regime.confidence}, ${regime.on_score}/${regime.off_score} on/off)`);

  // Divergences
  if (divs.length > 0) items.push(`⚠ ${divs.length} divergence(s) flagged — see full brief`);

  return items;
}

// ── MARKDOWN EXPORT ──
function toMarkdown(brief) {
  const d = brief.timestamp.substring(0, 10);
  let md = `# TradeBobby Daily Brief — ${d}\n`;
  md += `_Generated ${brief.timestamp}_\n\n`;

  md += `## Regime: **${brief.regime.verdict}** (confidence ${brief.regime.confidence})\n`;
  brief.regime.reasons.forEach(r => md += `- ${r}\n`);
  md += `\n`;

  md += `## Action Items\n`;
  brief.action_items.forEach(a => md += `- ${a}\n`);
  md += `\n`;

  md += `## Trade Ideas (top ${brief.ideas.length})\n\n`;
  brief.ideas.slice(0, 8).forEach((i, idx) => {
    md += `### ${idx+1}. ${i.grade} · ${i.direction} ${i.symbol} (score ${i.synthesis_score})\n`;
    if (i.entry) md += `- Entry **${i.entry}** · SL ${i.sl} · TP1 ${i.tp1 || '—'} · TP2 ${i.tp2 || '—'} · R:R ${i.rr || '—'}\n`;
    md += `- Source: ${i.source}\n`;
    md += `- Rationale:\n`;
    (i.reasons || []).forEach(r => md += `  - ${r}\n`);
    if (i.flags?.length) {
      md += `- ⚠ Flags:\n`;
      i.flags.forEach(f => md += `  - ${f}\n`);
    }
    md += `\n`;
  });

  if (brief.divergences.length) {
    md += `## Divergences & Conflicts\n`;
    brief.divergences.forEach(d => md += `- **${d.kind}** ${d.asset}: ${d.detail}\n`);
    md += `\n`;
  }

  md += `## Upcoming Catalysts (7d)\n`;
  brief.catalysts.econ.forEach(e => {
    const dt = new Date(e.datetime).toUTCString().substring(5, 22);
    md += `- ${dt} · **${e.impact}** ${e.name} → ${(e.affects || []).join(', ')}\n`;
  });
  if (brief.catalysts.earnings.length) {
    md += `\n## Upcoming Earnings\n`;
    brief.catalysts.earnings.forEach(e => {
      md += `- ${e.date} · **${e.symbol}**${e.is_mag7?' 🔥':''} · ${e.time?.includes('pre') ? 'PRE' : e.time?.includes('after') ? 'POST' : ''} · forecast ${e.eps_forecast}\n`;
    });
  }

  return md;
}

// ── MAIN ──
// ── SENTIMENT TRAJECTORY (rolling 48 snapshots = 12h at 15min) ──
function appendSentimentHistory(data, risk, regime) {
  const HIST = join(__dirname, 'sentiment_history.json');
  let hist = readJSON(HIST) || { snapshots: [] };
  const snap = {
    t: new Date().toISOString(),
    risk: risk.score,
    label: risk.label,
    regime: regime.verdict,
    vix: data.macro.data.vix?.price ?? null,
    dxy: data.macro.data.dxy?.price ?? null,
    fg: data.crypto.fear_greed?.current ?? null,
    gold_sent: data.news.sentiment?.gold?.avg ?? null,
    oil_sent: data.news.sentiment?.oil?.avg ?? null,
    silver_sent: data.news.sentiment?.silver?.avg ?? null,
    triggers: (data.news.critical_triggers || []).length,
    btc_dom: data.crypto.dominance?.btc_dominance ?? null
  };
  hist.snapshots.push(snap);
  hist.snapshots = hist.snapshots.slice(-96);  // 24h at 15min
  writeJsonAtomic(HIST, hist);
  return hist;
}

async function run() {
  log('🔄 Synthesizing trade brief...');
  const data = loadAll();
  const regime = classifyRegime(data);
  const risk = riskIndex(data);
  const divergences = findDivergences(data);
  const ideas = generateIdeas(data, regime);
  const catalysts = listCatalysts(data);
  const action = actionItems(data, regime, ideas, divergences);
  appendSentimentHistory(data, risk, regime);

  const brief = {
    timestamp: new Date().toISOString(),
    regime,
    risk_index: risk,
    action_items: action,
    ideas,
    divergences,
    catalysts,
    snapshot: {
      vix: data.macro.data.vix?.price,
      dxy: data.macro.data.dxy?.price,
      us10y: data.macro.data.us10y?.price,
      btc_dom: data.crypto.dominance?.btc_dominance,
      fear_greed: data.crypto.fear_greed?.current,
      reddit_mania: data.reddit.mania_level,
      cot_extremes: (data.cot.markets || []).filter(m => m.signal?.extreme).map(m => ({ asset: m.asset, bias: m.signal.bias })),
      session: data.setups.market_context?.session,
      news_triggers: (data.news.critical_triggers || []).length
    }
  };

  writeJsonAtomic(OUT, brief);
  writeFileSync(MD_OUT, toMarkdown(brief));

  log(`✅ Brief: ${regime.verdict} · ${ideas.length} ideas · ${divergences.length} divergences · top: ${ideas[0]?.grade || '—'} ${ideas[0]?.direction || ''} ${ideas[0]?.symbol || ''}`);
  return brief;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 15 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

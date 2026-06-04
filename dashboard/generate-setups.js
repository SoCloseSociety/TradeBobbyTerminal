// Enhanced setup generator — v2 with momentum, correlation, anticipation
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN_PATH = join(__dirname, 'last_scan.json');
const SETUPS_PATH = join(__dirname, 'live_setups.json');
const PORTFOLIO_PATH = join(__dirname, '..', 'paper_portfolio.json');
const HISTORY_PATH = join(__dirname, 'scan_history.json');

function assetType(sym) {
  if (['BTCUSD','ETHUSD','SOLUSD','XRPUSD'].includes(sym)) return 'crypto';
  if (['XAUUSD','XAGUSD','USOIL','UKOIL'].includes(sym)) return 'commodity';
  if (['NAS100','SPX500','DAX','CAC40'].includes(sym)) return 'index';
  return 'forex';
}

function calcSize(riskUSD, riskPts, sym) {
  const type = assetType(sym);
  if (riskPts <= 0) return { size: 0, unit: '' };
  switch (type) {
    case 'crypto':
      return { size: +(riskUSD / riskPts).toFixed(4), unit: sym.replace('USD','') };
    case 'forex': {
      const isJPY = sym.includes('JPY');
      const pipValue = isJPY ? 0.01 : 0.0001;
      const pips = riskPts / pipValue;
      const pipUSD = isJPY ? 6.3 : 10;
      return { size: +(riskUSD / (pips * pipUSD)).toFixed(2), unit: 'lots' };
    }
    case 'index':
      return { size: +(riskUSD / riskPts).toFixed(2), unit: 'contracts' };
    case 'commodity': {
      const multi = sym.includes('OIL') ? 10 : 1;
      return { size: +(riskUSD / (riskPts * multi)).toFixed(2), unit: 'lots' };
    }
    default:
      return { size: +(riskUSD / riskPts).toFixed(4), unit: '' };
  }
}

function prc(val, sym) {
  const type = assetType(sym);
  if (type === 'forex') return sym.includes('JPY') ? +val.toFixed(3) : +val.toFixed(5);
  if (type === 'crypto') return val > 100 ? Math.round(val) : +val.toFixed(4);
  if (type === 'index') return +val.toFixed(1);
  return +val.toFixed(2);
}

// Calculate market regime from all symbols
function calculateMarketRegime(scan) {
  const regime = { riskOn: 0, riskOff: 0, volatility: 0, totalMoves: 0 };
  if (!scan.symbols) return regime;

  // Risk-on indicators: tech indices, crypto up
  // Risk-off: JPY strong, gold up, oil down
  for (const s of scan.symbols) {
    const d = s.tf_240 || {};
    if (d.Structure?.includes('BULL')) {
      if (['NAS100','SPX500','BTCUSD','ETHUSD','SOLUSD'].includes(s.symbol)) regime.riskOn++;
      if (['XAUUSD','USDJPY'].includes(s.symbol)) regime.riskOff++;
    }
    if (d.Structure?.includes('BEAR')) {
      if (['NAS100','SPX500','BTCUSD','ETHUSD'].includes(s.symbol)) regime.riskOff++;
      if (['XAUUSD'].includes(s.symbol)) regime.riskOn++;
    }
    if (d['Squeeze']?.includes('ON')) regime.volatility--;
    else regime.volatility++;
    regime.totalMoves++;
  }

  regime.bias = regime.riskOn > regime.riskOff * 1.5 ? 'RISK-ON'
              : regime.riskOff > regime.riskOn * 1.5 ? 'RISK-OFF'
              : 'MIXED';
  return regime;
}

// Get current session from timestamp
function getSession() {
  const utcPlus7Hour = new Date().getUTCHours() + 7;
  const h = utcPlus7Hour >= 24 ? utcPlus7Hour - 24 : utcPlus7Hour;
  if (h >= 20.5 && h < 24) return 'KILLZONE';     // 20:30-00:00 London/NY overlap
  if (h >= 20.5 || h < 5.5) return 'NY';           // 20:30-05:30
  if (h >= 15 && h < 24) return 'LONDON';          // 15:00-00:00
  if (h >= 6 && h < 15) return 'ASIA';             // 06:00-15:00
  return 'OFF';
}

// Calculate momentum score from history
function calcMomentum(symbol, history) {
  if (!history || !history.scans || history.scans.length < 3) return { score: 0, trend: 'unknown' };

  const prices = history.scans
    .slice(-5)
    .map(s => s.prices?.[symbol])
    .filter(p => p && !isNaN(p));

  if (prices.length < 3) return { score: 0, trend: 'unknown' };

  const first = prices[0];
  const last = prices[prices.length - 1];
  const mid = prices[Math.floor(prices.length / 2)];

  const pctChange = ((last - first) / first) * 100;
  const recentChange = ((last - mid) / mid) * 100;

  // Acceleration: is the recent change bigger than the early change?
  const earlyChange = ((mid - first) / first) * 100;
  const accelerating = Math.sign(recentChange) === Math.sign(earlyChange) && Math.abs(recentChange) > Math.abs(earlyChange);

  let score = 0;
  if (pctChange > 1) score += 2;
  else if (pctChange > 0.3) score += 1;
  else if (pctChange < -1) score -= 2;
  else if (pctChange < -0.3) score -= 1;

  if (accelerating) score = score * 1.5;

  return {
    score: Math.round(score * 10) / 10,
    trend: pctChange > 0.3 ? 'up' : pctChange < -0.3 ? 'down' : 'flat',
    pctChange: +pctChange.toFixed(2),
    accelerating
  };
}

// Record current scan in history (deduped by timestamp)
function updateHistory(scan) {
  let history = existsSync(HISTORY_PATH) ? JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) : { scans: [] };
  const prices = {};
  for (const s of (scan.symbols || [])) prices[s.symbol] = s.price;
  // Skip if we already recorded this exact scan (prevents 20× dup from repeat API calls)
  const lastScan = history.scans[history.scans.length - 1];
  if (lastScan && lastScan.timestamp === scan.timestamp) return history;
  history.scans.push({ timestamp: scan.timestamp, prices });
  if (history.scans.length > 20) history.scans = history.scans.slice(-20);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  return history;
}

export function generateSetups() {
  if (!existsSync(SCAN_PATH)) return { setups: [], timestamp: null };

  const scan = JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
  const pf = existsSync(PORTFOLIO_PATH) ? JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8')) : null;

  // Load macro context for geopolitical scoring
  const macroPath = join(__dirname, 'macro_context.json');
  const macro = existsSync(macroPath) ? JSON.parse(readFileSync(macroPath, 'utf8')) : null;

  // Load live news sentiment (from news-scanner.js)
  const newsPath = join(__dirname, 'news_feed.json');
  const news = existsSync(newsPath) ? JSON.parse(readFileSync(newsPath, 'utf8')) : null;
  const newsAge = news?.timestamp ? (Date.now() - new Date(news.timestamp).getTime()) / 60000 : Infinity;
  const newsFresh = newsAge < 60; // use news sentiment only if <60min old

  // Record history
  const history = updateHistory(scan);

  // Calculate market context
  const regime = calculateMarketRegime(scan);
  const session = getSession();

  // Active = not closed out
  const CLOSED_STATUSES = ['CLOSED', 'TP2_HIT', 'SL_HIT'];
  const openSymbols = new Set();
  for (const p of (pf?.open_positions || [])) { if (!CLOSED_STATUSES.includes(p.status)) openSymbols.add(p.symbol); }
  for (const p of (pf?.pending_orders || [])) { if (p.status === 'PENDING') openSymbols.add(p.symbol); }
  const rtPath = join(__dirname, 'real_trades.json');
  const rt = existsSync(rtPath) ? JSON.parse(readFileSync(rtPath, 'utf8')) : { trades: [] };
  for (const t of (rt.trades || [])) { if (t.status === 'OPEN') openSymbols.add(t.symbol); }
  const slotsAvail = 3 - openSymbols.size;

  const setups = [];
  const riskUSD = (pf?.account?.balance || 10000) * (pf?.account?.risk_per_trade_pct || 1) / 100;

  // Blacklist removed — user wants to trade all symbols
  // Note from backtest: BTCUSD/XAUUSD/USOIL had 0% WR but user has discretion

  for (const s of (scan.symbols || [])) {
    if (openSymbols.has(s.symbol)) continue;

    const d4h = s.tf_240 || {};
    const d1h = s.tf_60 || {};
    const price = s.price;
    if (!price || !d4h.Structure) continue;

    const struct4h = d4h.Structure || '';
    const struct1h = d1h.Structure || '';
    const htf = d4h['HTF (D)'] || '';
    const zone = d4h.Zone || '';
    const mtf = d4h['MTF (D/4H/cur)'] || '';
    const conf4h = parseInt((d4h.Confluence || '0').split('/')[0]) || 0;
    const conf1h = parseInt((d1h.Confluence || '0').split('/')[0]) || 0;
    const bestConf = Math.max(conf4h, conf1h);
    const atr = parseFloat(d4h['ATR(14)'] || '0');
    const wr = d4h.Record || '';
    const targets = d4h['Targets ↑/↓'] || '';
    const [targetUp, targetDown] = targets.split('/').map(t => parseFloat(t?.trim()));
    const squeeze4h = d4h['Squeeze'] || '';
    const pdh = parseFloat(d4h['PDH / PDL']?.split('/')[0]?.trim()) || NaN;
    const pdl = parseFloat(d4h['PDH / PDL']?.split('/')[1]?.trim()) || NaN;
    const pwh = parseFloat(d4h['PWH / PWL']?.split('/')[0]?.trim()) || NaN;
    const pwl = parseFloat(d4h['PWH / PWL']?.split('/')[1]?.trim()) || NaN;

    // Direction
    let direction = '';
    let score = 0;
    const reasons = [];

    if (mtf.includes('BULL')) { direction = 'LONG'; score += 4; reasons.push('MTF ' + mtf.trim()); }
    else if (mtf.includes('BEAR')) { direction = 'SHORT'; score += 4; reasons.push('MTF ' + mtf.trim()); }
    else if (struct4h.includes('BULL') && htf.includes('BULL')) { direction = 'LONG'; score += 3; reasons.push('4H+D BULL'); }
    else if (struct4h.includes('BEAR') && htf.includes('BEAR')) { direction = 'SHORT'; score += 3; reasons.push('4H+D BEAR'); }
    else if (struct4h.includes('BULL') && struct1h.includes('BULL')) { direction = 'LONG'; score += 2; reasons.push('4H+1H BULL'); }
    else if (struct4h.includes('BEAR') && struct1h.includes('BEAR')) { direction = 'SHORT'; score += 2; reasons.push('4H+1H BEAR'); }
    else continue;

    // ── NEW: MOMENTUM ANALYSIS ──
    const momentum = calcMomentum(s.symbol, history);
    if (direction === 'LONG' && momentum.trend === 'up') {
      score += momentum.accelerating ? 2 : 1;
      if (momentum.accelerating) reasons.push('Momentum accelerating ↑ (+' + momentum.pctChange + '%)');
      else reasons.push('Momentum up (+' + momentum.pctChange + '%)');
    }
    if (direction === 'SHORT' && momentum.trend === 'down') {
      score += momentum.accelerating ? 2 : 1;
      if (momentum.accelerating) reasons.push('Momentum accelerating ↓ (' + momentum.pctChange + '%)');
      else reasons.push('Momentum down (' + momentum.pctChange + '%)');
    }
    // Counter-momentum penalty
    if (direction === 'LONG' && momentum.trend === 'down' && Math.abs(momentum.pctChange) > 1) {
      score -= 2;
      reasons.push('⚠️ Counter-momentum (prix en baisse)');
    }
    if (direction === 'SHORT' && momentum.trend === 'up' && Math.abs(momentum.pctChange) > 1) {
      score -= 2;
      reasons.push('⚠️ Counter-momentum (prix en hausse)');
    }

    // ── NEW: MARKET REGIME FILTER ──
    if (regime.bias === 'RISK-ON') {
      if (direction === 'LONG' && ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','NAS100','SPX500','DAX','CAC40'].includes(s.symbol)) {
        score += 1;
        reasons.push('Risk-ON favorable (long risk assets)');
      }
      if (direction === 'SHORT' && ['XAUUSD','XAGUSD','USDJPY'].includes(s.symbol)) {
        score += 1;
        reasons.push('Risk-ON favorable (short safe haven)');
      }
    }
    if (regime.bias === 'RISK-OFF') {
      if (direction === 'LONG' && ['XAUUSD','XAGUSD','USDJPY'].includes(s.symbol)) {
        score += 1;
        reasons.push('Risk-OFF favorable (long safe haven)');
      }
      if (direction === 'SHORT' && ['BTCUSD','ETHUSD','NAS100','SPX500','DAX','CAC40'].includes(s.symbol)) {
        score += 1;
        reasons.push('Risk-OFF favorable (short risk assets)');
      }
    }

    // ── INDICES SPECIFIC: respect session opens strongly ──
    const indices = ['NAS100','SPX500','DAX','CAC40'];
    if (indices.includes(s.symbol)) {
      // Indices react to session opens — extra points if during London/NY
      if (session === 'LONDON' || session === 'NY' || session === 'KILLZONE') {
        score += 1;
        reasons.push('Index during active session');
      }
    }

    // ── COMMODITIES SPECIFIC: respect key levels, volatility aware ──
    const commodities = ['XAUUSD','XAGUSD','USOIL','UKOIL'];
    if (commodities.includes(s.symbol)) {
      const keyProx = atr * 0.8;
      const nearKeyLvl = (!isNaN(pdh) && Math.abs(price - pdh) < keyProx) ||
                         (!isNaN(pdl) && Math.abs(price - pdl) < keyProx) ||
                         (!isNaN(pwh) && Math.abs(price - pwh) < keyProx) ||
                         (!isNaN(pwl) && Math.abs(price - pwl) < keyProx);
      if (nearKeyLvl) {
        score += 2;
        reasons.push('Commodity near key level (bounce/breakout)');
      }
      // Gold: short rejections at highs work better than longs
      if (s.symbol === 'XAUUSD' && direction === 'SHORT' && !isNaN(pwh) && price >= pwh * 0.99) {
        score += 1;
        reasons.push('Gold rejecting PWH');
      }
    }

    // ── NEW: SESSION CONTEXT ──
    const indexes = ['NAS100','SPX500','DAX','CAC40'];
    const forex = ['EURUSD','GBPUSD','GBPJPY','USDJPY'];
    if (session === 'KILLZONE' || session === 'NY') {
      if (indexes.includes(s.symbol) || forex.includes(s.symbol)) {
        score += 1;
        reasons.push(session + ' session optimal');
      }
    }
    if (session === 'LONDON' && forex.includes(s.symbol)) {
      score += 1;
      reasons.push('London session favorable');
    }
    if (session === 'ASIA' && s.symbol === 'USDJPY') {
      score += 1;
      reasons.push('Asia session favorable');
    }
    if (session === 'OFF' || session === 'ASIA') {
      if (indexes.includes(s.symbol)) {
        score -= 1;
        reasons.push('⚠️ ' + session + ' session — indices calmes');
      }
    }

    // ── NEW: BREAKOUT IMMINENT (squeeze release) ──
    if (squeeze4h.includes('ON')) {
      const hasMomentumMatch = (direction === 'LONG' && squeeze4h.includes('+')) || (direction === 'SHORT' && squeeze4h.includes('-'));
      if (hasMomentumMatch) {
        score += 2;
        reasons.push('⚡ SQUEEZE release imminent');
      } else {
        score += 1;
        reasons.push('Squeeze ON — volatilité à venir');
      }
    }

    // Zone bonus/penalty
    let zoneWarning = '';
    if (direction === 'LONG' && zone.includes('DISCOUNT')) { score += 2; reasons.push('Discount zone'); }
    else if (direction === 'SHORT' && zone.includes('PREMIUM')) { score += 2; reasons.push('Premium zone'); }
    else if (direction === 'LONG' && zone.includes('PREMIUM') && !zone.includes('OTE')) {
      zoneWarning = 'Achat PREMIUM';
      score -= 1;
    }
    else if (direction === 'SHORT' && zone.includes('DISCOUNT') && !zone.includes('OTE')) {
      if (struct4h.includes('BEAR') && htf.includes('BEAR')) {
        zoneWarning = 'Short DISCOUNT aligné (breakdown)';
      } else {
        zoneWarning = 'Short DISCOUNT';
        score -= 1;
      }
    }
    if (zone.includes('OTE')) { score += 1; reasons.push('Zone OTE'); }

    // Confluence + WR bonus
    score += Math.min(bestConf, 4);
    if (bestConf >= 4) reasons.push('Conf ' + bestConf + '/10');
    const wrMatch = wr.match(/(\d+)%/);
    const wrPct = wrMatch ? parseInt(wrMatch[1]) : 0;
    if (wrPct >= 50) { score += 1; reasons.push('WR ' + wrPct + '%'); }

    if (score < 3) continue;

    // ── Calculate entry/SL/TP ──
    const slDist = atr * 1.5;
    let entry, sl, tp1, tp2;
    let entryType = 'LIMIT';

    // A+ setup + momentum aligned = MARKET entry
    if (score >= 8 || (score >= 6 && momentum.accelerating)) entryType = 'MARKET';

    if (direction === 'LONG') {
      entry = entryType === 'MARKET' ? prc(price, s.symbol) : prc(price - atr * 0.3, s.symbol);
      sl = prc(entry - slDist, s.symbol);
      const riskPts = entry - sl;
      tp1 = prc(entry + riskPts, s.symbol);
      tp2 = prc(entry + riskPts * 2, s.symbol);
      const keyTargets = [pdh, pwh, targetUp].filter(t => !isNaN(t) && t > tp1);
      if (keyTargets.length > 0) {
        const nearest = Math.min(...keyTargets);
        const altRR = (nearest - entry) / riskPts;
        if (altRR >= 1.5 && altRR <= 4) tp2 = prc(nearest, s.symbol);
      }
    } else {
      entry = entryType === 'MARKET' ? prc(price, s.symbol) : prc(price + atr * 0.3, s.symbol);
      sl = prc(entry + slDist, s.symbol);
      const riskPts = sl - entry;
      tp1 = prc(entry - riskPts, s.symbol);
      tp2 = prc(entry - riskPts * 2, s.symbol);
      const keyTargets = [pdl, pwl, targetDown].filter(t => !isNaN(t) && t < tp1);
      if (keyTargets.length > 0) {
        const nearest = Math.max(...keyTargets);
        const altRR = (entry - nearest) / riskPts;
        if (altRR >= 1.5 && altRR <= 4) tp2 = prc(nearest, s.symbol);
      }
    }

    const riskPts = Math.abs(entry - sl);
    const rr = riskPts > 0 ? +(Math.abs(tp2 - entry) / riskPts).toFixed(1) : 0;
    const { size, unit } = calcSize(riskUSD, riskPts, s.symbol);

    // Entry distance from current price (in ATR units)
    const entryDistATR = atr > 0 ? +(Math.abs(entry - price) / atr).toFixed(2) : 0;

    if (zoneWarning) reasons.push(zoneWarning);
    if (entryType === 'MARKET') reasons.unshift('⚡ MARKET ENTRY');

    // ── MACRO GEOPOLITICAL SCORING ──
    if (macro?.institutional) {
      // Silver: massive long bias from COMEX squeeze
      if (s.symbol === 'XAGUSD') {
        if (direction === 'LONG') {
          score += 3;
          reasons.push('COMEX squeeze active + China export ban');
        }
        if (direction === 'SHORT') {
          score -= 3;
          reasons.push('⛔ SHORT silver = fighting COMEX squeeze');
        }
      }
      // Gold: central banks buy all dips, shorts are scalps only
      if (s.symbol === 'XAUUSD') {
        if (direction === 'LONG') {
          score += 1;
          reasons.push('Central banks buy dips (755t/year)');
        }
        if (direction === 'SHORT') {
          score -= 1;
          reasons.push('⚠️ Gold short = scalp only (CB buying floor)');
        }
      }
      // Oil: political weapon
      if (['USOIL','UKOIL'].includes(s.symbol)) {
        reasons.push('Oil = geopolitical (sanctions active on Iran/Venezuela/Russia)');
      }
    }

    // ── LIVE NEWS SENTIMENT SCORING ──
    if (newsFresh && news?.sentiment) {
      const sent = news.sentiment;
      const applySent = (s, longBonus, shortBonus, label) => {
        if (!s) return;
        if (s.bias === 'BULLISH') {
          if (direction === 'LONG') { score += longBonus; reasons.push('📰 News BULLISH ' + label + ' (+' + longBonus + ')'); }
          if (direction === 'SHORT') { score -= longBonus; reasons.push('📰 News BULLISH ' + label + ' contradicts SHORT (-' + longBonus + ')'); }
        } else if (s.bias === 'BEARISH') {
          if (direction === 'SHORT') { score += shortBonus; reasons.push('📰 News BEARISH ' + label + ' (+' + shortBonus + ')'); }
          if (direction === 'LONG') { score -= shortBonus; reasons.push('📰 News BEARISH ' + label + ' contradicts LONG (-' + shortBonus + ')'); }
        }
      };
      if (s.symbol === 'XAUUSD') applySent(sent.gold, 2, 2, 'Gold');
      if (['USOIL','UKOIL'].includes(s.symbol)) applySent(sent.oil, 2, 2, 'Oil');
      if (s.symbol === 'XAGUSD') applySent(sent.silver, 2, 1, 'Silver');

      // Risk-off penalizes equity/crypto longs, boosts gold longs
      if (sent.risk_off?.level === 'HIGH') {
        if (['NAS100','SPX500','BTCUSD','ETHUSD'].includes(s.symbol) && direction === 'LONG') {
          score -= 2; reasons.push('⚠️ Risk-off HIGH: equities/crypto fragile');
        }
        if (s.symbol === 'XAUUSD' && direction === 'LONG') {
          score += 1; reasons.push('📰 Risk-off HIGH: safe-haven demand');
        }
      }

      // Critical triggers affecting this asset = alert but not auto-score (user reviews)
      const triggersForAsset = (news.critical_triggers || []).filter(t => t.assets?.includes(s.symbol));
      if (triggersForAsset.length > 0) {
        const extreme = triggersForAsset.filter(t => t.impact === 'EXTREME');
        if (extreme.length > 0) {
          reasons.push('🚨 EXTREME trigger: ' + extreme.map(t => t.trigger).slice(0, 2).join(', '));
        } else {
          reasons.push('⚡ News triggers active: ' + triggersForAsset.map(t => t.trigger).slice(0, 2).join(', '));
        }
      }
    }

    // ── STACK SAFETY CHECK ──
    // For margin stacking strategy: is it safe to pyramid?
    const volStr = d4h['Volume'] || '';
    const volPct = parseInt(volStr) || 0;
    const hasVolume = volPct >= 100; // volume >= 100% of average
    const hasDirection = (mtf.includes('BULL') || mtf.includes('BEAR')) || (struct4h === struct1h && struct4h !== '');
    const isNotRange = !squeeze4h.includes('ON'); // squeeze = compression = range
    const safeToStack = hasVolume && hasDirection && isNotRange;
    const stackLabel = safeToStack ? 'STACK OK' : 'NO STACK';

    if (safeToStack) {
      score += 2;
      reasons.push('✅ SAFE TO STACK (volume + direction + no range)');
    } else {
      const stackWarnings = [];
      if (!hasVolume) stackWarnings.push('Low volume (' + volPct + '%)');
      if (!hasDirection) stackWarnings.push('No clear direction');
      if (!isNotRange) stackWarnings.push('Squeeze/range detected');
      reasons.push('⛔ NO STACK: ' + stackWarnings.join(', '));
    }

    // Quality label
    const quality = score >= 10 ? 'S' : score >= 8 ? 'A+' : score >= 6 ? 'A' : score >= 4 ? 'B' : 'C';

    setups.push({
      symbol: s.symbol,
      direction,
      quality,
      entryType,
      price,
      entry,
      sl,
      tp1,
      tp2,
      rr,
      size,
      unit,
      risk_usd: Math.round(riskUSD),
      score: Math.round(score * 10) / 10,
      conf: bestConf,
      zone,
      mtf: mtf.trim(),
      wr,
      wrPct,
      reasons,
      atr,
      momentum,
      entryDistATR,
      warning: zoneWarning || null,
      stackSafe: safeToStack,
      stackLabel
    });
  }

  setups.sort((a, b) => b.score - a.score);

  const result = {
    timestamp: new Date().toISOString(),
    scan_time: scan.timestamp,
    slots_available: slotsAvail,
    market_context: {
      session,
      regime: regime.bias,
      riskOn_count: regime.riskOn,
      riskOff_count: regime.riskOff
    },
    setups: setups.slice(0, 6)
  };

  writeFileSync(SETUPS_PATH, JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1]?.includes('generate-setups')) {
  const r = generateSetups();
  console.log('\n=== MARKET CONTEXT ===');
  console.log('Session:', r.market_context.session);
  console.log('Regime:', r.market_context.regime, '(' + r.market_context.riskOn_count + ' risk-on / ' + r.market_context.riskOff_count + ' risk-off)');
  console.log('\n=== SETUPS (' + r.setups.length + ') | Slots: ' + r.slots_available + ' ===');
  r.setups.forEach(s => {
    console.log(`\n[${s.quality}] ${s.symbol} ${s.direction} [${s.entryType}] | Score: ${s.score}`);
    console.log(`  Entry: ${s.entry} (${s.entryDistATR}x ATR from ${s.price}) | SL: ${s.sl} | TP1: ${s.tp1} | TP2: ${s.tp2} | R:R ${s.rr}`);
    console.log(`  Size: ${s.size} ${s.unit} | Momentum: ${s.momentum.trend} ${s.momentum.pctChange}%`);
    console.log(`  Reasons: ${s.reasons.join(' · ')}`);
  });
}

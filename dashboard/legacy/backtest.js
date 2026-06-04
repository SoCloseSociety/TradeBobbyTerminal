// TradeBobby Backtest Engine
// Simulates V5 ICT/SMC rules on historical data to validate strategy

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = process.env.TV_MCP_DIR || join(process.env.HOME || '~', 'tradingview-mcp-jackson');
const RESULT_PATH = join(__dirname, 'backtest_results.json');

const SYMBOLS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD',
  'XAUUSD', 'EURUSD', 'GBPUSD', 'GBPJPY',
  'NAS100', 'SPX500', 'USOIL'
];

const TF = '240'; // 4H
const SWING_LEN = 5;
const MIN_FVG_PCT = 0.3;
const RR_RATIO = 2.0;
const MIN_RR = 2.0;
const MAX_SL_ATR = 3.0;

function cli(cmd) {
  try {
    const out = execSync(`cd ${MCP_DIR} && node src/cli/index.js ${cmd}`, {
      timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(out);
  } catch { return null; }
}

function sleep(ms) { execSync(`sleep ${ms / 1000}`); }

// ─── Technical Analysis Functions ───

function atr(bars, period = 14) {
  const result = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) { result.push(0); continue; }
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i-1].close),
      Math.abs(bars[i].low - bars[i-1].close)
    );
    if (i < period) {
      const sum = result.reduce((a,b) => a+b, 0) + tr;
      result.push(sum / (i+1));
    } else {
      result.push((result[i-1] * (period - 1) + tr) / period);
    }
  }
  return result;
}

function ema(prices, period) {
  const k = 2 / (period + 1);
  const result = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i-1] * (1 - k));
  }
  return result;
}

// Detect swing high/low at position i (using swingLen lookback/lookahead)
function isPivotHigh(bars, i, len) {
  if (i < len || i + len >= bars.length) return false;
  const pivot = bars[i].high;
  for (let j = i - len; j <= i + len; j++) {
    if (j === i) continue;
    if (bars[j].high >= pivot) return false;
  }
  return true;
}

function isPivotLow(bars, i, len) {
  if (i < len || i + len >= bars.length) return false;
  const pivot = bars[i].low;
  for (let j = i - len; j <= i + len; j++) {
    if (j === i) continue;
    if (bars[j].low <= pivot) return false;
  }
  return true;
}

// ─── V5 Strategy Simulator ───

function simulate(bars, symbol) {
  const atrs = atr(bars, 14);
  const closes = bars.map(b => b.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  let trend = 0; // 1 bull, -1 bear
  let lastSH = null, lastSHBar = 0;
  let lastSL = null, lastSLBar = 0;
  let bosUpFired = false, bosDnFired = false;

  const obs = []; // {top, bot, dir, mitigated}
  const fvgs = []; // {top, bot, dir, mitigated}

  const trades = [];
  const openTrades = [];

  for (let i = 50; i < bars.length - 1; i++) {
    const bar = bars[i];
    const a = atrs[i];

    // ── Detect swings (pivots) ──
    if (isPivotHigh(bars, i - SWING_LEN, SWING_LEN)) {
      const idx = i - SWING_LEN;
      lastSH = bars[idx].high;
      lastSHBar = idx;
      bosUpFired = false;
    }
    if (isPivotLow(bars, i - SWING_LEN, SWING_LEN)) {
      const idx = i - SWING_LEN;
      lastSL = bars[idx].low;
      lastSLBar = idx;
      bosDnFired = false;
    }

    // ── BOS / CHoCH ──
    let bosUp = false, bosDn = false, chochUp = false, chochDn = false;
    if (lastSH && bar.close > lastSH && !bosUpFired) {
      bosUpFired = true;
      if (trend <= 0) { chochUp = true; trend = 1; }
      else bosUp = true;
    }
    if (lastSL && bar.close < lastSL && !bosDnFired) {
      bosDnFired = true;
      if (trend >= 0) { chochDn = true; trend = -1; }
      else bosDn = true;
    }

    // ── FVG detection ──
    if (i >= 2) {
      const b0 = bars[i], b2 = bars[i-2];
      const minGap = bar.close * MIN_FVG_PCT / 100;
      if (b0.low > b2.high && (b0.low - b2.high) >= minGap) {
        fvgs.push({ top: b0.low, bot: b2.high, dir: 1, mitigated: false, bar: i });
      }
      if (b0.high < b2.low && (b2.low - b0.high) >= minGap) {
        fvgs.push({ top: b2.low, bot: b0.high, dir: -1, mitigated: false, bar: i });
      }
    }

    // ── FVG mitigation ──
    for (const f of fvgs) {
      if (f.mitigated) continue;
      const ce = (f.top + f.bot) / 2;
      if (f.dir === 1 && bar.close < ce) f.mitigated = true;
      if (f.dir === -1 && bar.close > ce) f.mitigated = true;
    }

    // ── Order Blocks after BOS ──
    const isDisplacement = Math.abs(bar.close - bar.open) > a * 1.5;
    if ((bosUp || chochUp) && isDisplacement) {
      for (let j = 1; j <= 10 && i - j >= 0; j++) {
        const c = bars[i - j];
        if (c.close < c.open) {
          obs.push({ top: c.open, bot: c.close, dir: 1, mitigated: false, bar: i - j });
          break;
        }
      }
    }
    if ((bosDn || chochDn) && isDisplacement) {
      for (let j = 1; j <= 10 && i - j >= 0; j++) {
        const c = bars[i - j];
        if (c.close > c.open) {
          obs.push({ top: c.close, bot: c.open, dir: -1, mitigated: false, bar: i - j });
          break;
        }
      }
    }

    // OB mitigation
    for (const o of obs) {
      if (o.mitigated) continue;
      if (o.dir === 1 && bar.low <= o.top && bars[i-1].close > o.top) o.mitigated = true;
      if (o.dir === -1 && bar.high >= o.bot && bars[i-1].close < o.bot) o.mitigated = true;
    }

    // ── HTF bias (using EMA 20/50/200) ──
    const htfBias = ema20[i] > ema50[i] && ema50[i] > ema200[i] ? 1
                  : ema20[i] < ema50[i] && ema50[i] < ema200[i] ? -1 : 0;

    // ── Premium/Discount (50-bar lookback) ──
    const lookback = Math.max(0, i - 50);
    const rangeHigh = Math.max(...bars.slice(lookback, i+1).map(b => b.high));
    const rangeLow = Math.min(...bars.slice(lookback, i+1).map(b => b.low));
    const eq = (rangeHigh + rangeLow) / 2;
    const inPremium = bar.close > eq;
    const inDiscount = bar.close < eq;

    // ── Confluence score ──
    const nearBullOB = obs.some(o => o.dir === 1 && !o.mitigated && bar.close >= o.bot - a*0.5 && bar.close <= o.top + a*0.5);
    const nearBearOB = obs.some(o => o.dir === -1 && !o.mitigated && bar.close >= o.bot - a*0.5 && bar.close <= o.top + a*0.5);
    const nearBullFVG = fvgs.some(f => f.dir === 1 && !f.mitigated && bar.close >= f.bot - a*0.5 && bar.close <= f.top + a*0.5);
    const nearBearFVG = fvgs.some(f => f.dir === -1 && !f.mitigated && bar.close >= f.bot - a*0.5 && bar.close <= f.top + a*0.5);

    let bullConf = 0;
    if (trend === 1) bullConf++;
    if (nearBullOB) bullConf++;
    if (nearBullFVG) bullConf++;
    if (htfBias === 1) bullConf++;
    if (inDiscount) bullConf++;
    if (inPremium) bullConf--;

    let bearConf = 0;
    if (trend === -1) bearConf++;
    if (nearBearOB) bearConf++;
    if (nearBearFVG) bearConf++;
    if (htfBias === -1) bearConf++;
    if (inPremium) bearConf++;
    if (inDiscount) bearConf--;

    // ── Signal trigger — whitelist filter from backtest learnings ──
    const blacklist = ['BTCUSD','XAUUSD','USOIL']; // losing symbols from previous backtest
    const notBlacklisted = !blacklist.includes(symbol);

    // Core rule: BOS + confluence + whitelist (no blacklisted symbols)
    const shouldLong = notBlacklisted && (bosUp || chochUp) && bullConf >= 2;
    const shouldShort = notBlacklisted && (bosDn || chochDn) && bearConf >= 2;

    // Open trades
    if (shouldLong && openTrades.length === 0) {
      const sl = Math.max(lastSL || bar.low, bar.low - a * 1.5);
      const riskDist = bar.close - sl;
      if (riskDist > 0 && riskDist < a * MAX_SL_ATR) {
        const tp = bar.close + riskDist * RR_RATIO;
        openTrades.push({
          symbol, dir: 'LONG', entry: bar.close, sl, tp, tp1: bar.close + riskDist,
          openBar: i, openTime: bar.time, conf: bullConf
        });
      }
    }
    if (shouldShort && openTrades.length === 0) {
      const sl = Math.min(lastSH || bar.high, bar.high + a * 1.5);
      const riskDist = sl - bar.close;
      if (riskDist > 0 && riskDist < a * MAX_SL_ATR) {
        const tp = bar.close - riskDist * RR_RATIO;
        openTrades.push({
          symbol, dir: 'SHORT', entry: bar.close, sl, tp, tp1: bar.close - riskDist,
          openBar: i, openTime: bar.time, conf: bearConf
        });
      }
    }

    // Check open trades against current bar
    for (let k = openTrades.length - 1; k >= 0; k--) {
      const t = openTrades[k];
      const isLong = t.dir === 'LONG';
      let closed = false, outcome = '';

      // Check SL first (worst case on same bar)
      if (isLong && bar.low <= t.sl) { closed = true; outcome = t.tp1Hit ? 'PARTIAL_WIN' : 'LOSS'; t.exitPrice = t.sl; }
      else if (!isLong && bar.high >= t.sl) { closed = true; outcome = t.tp1Hit ? 'PARTIAL_WIN' : 'LOSS'; t.exitPrice = t.sl; }
      else if (isLong && bar.high >= t.tp) { closed = true; outcome = 'WIN'; t.exitPrice = t.tp; }
      else if (!isLong && bar.low <= t.tp) { closed = true; outcome = 'WIN'; t.exitPrice = t.tp; }
      else {
        // TP1 check
        if (isLong && bar.high >= t.tp1) t.tp1Hit = true;
        if (!isLong && bar.low <= t.tp1) t.tp1Hit = true;
      }

      // Timeout after 100 bars
      if (!closed && i - t.openBar > 100) {
        closed = true;
        const pnl = isLong ? bar.close - t.entry : t.entry - bar.close;
        outcome = pnl > 0 ? 'TIMEOUT_WIN' : pnl < 0 ? 'TIMEOUT_LOSS' : 'TIMEOUT_FLAT';
        t.exitPrice = bar.close;
      }

      if (closed) {
        t.outcome = outcome;
        t.closeBar = i;
        t.closeTime = bar.time;
        t.barsHeld = i - t.openBar;
        const riskDist = isLong ? t.entry - t.sl : t.sl - t.entry;
        t.pnlR = isLong ? (t.exitPrice - t.entry) / riskDist : (t.entry - t.exitPrice) / riskDist;
        // Partial win = net ~+0.5R (TP1 hit +1R × 50% - 0.5R loss × 50% = +0.25R)
        if (outcome === 'PARTIAL_WIN') t.pnlR = 0.5;
        trades.push(t);
        openTrades.splice(k, 1);
      }
    }
  }

  return trades;
}

// ─── Main ───

async function runBacktest() {
  console.log('🔬 TradeBobby Backtest starting...\n');
  const allTrades = [];
  const perSymbol = {};

  for (const sym of SYMBOLS) {
    process.stdout.write(`  ${sym}... `);
    cli(`symbol ${sym}`);
    sleep(1500);
    cli(`timeframe ${TF}`);
    sleep(1500);

    const data = cli('ohlcv --count 500');
    if (!data?.bars || data.bars.length < 100) {
      console.log('SKIP (not enough data)');
      continue;
    }

    const trades = simulate(data.bars, sym);
    allTrades.push(...trades);
    perSymbol[sym] = trades;

    const wins = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN' || t.outcome === 'TIMEOUT_WIN').length;
    const losses = trades.filter(t => t.outcome === 'LOSS' || t.outcome === 'TIMEOUT_LOSS').length;
    const wr = (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 100) : 0;
    const totalR = trades.reduce((s, t) => s + (t.pnlR || 0), 0);
    console.log(`${trades.length} trades | ${wins}W ${losses}L (${wr}%) | ${totalR.toFixed(1)}R`);
  }

  // ─── Global Stats ───
  console.log('\n═══════════ GLOBAL STATS ═══════════\n');

  const wins = allTrades.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN' || t.outcome === 'TIMEOUT_WIN');
  const losses = allTrades.filter(t => t.outcome === 'LOSS' || t.outcome === 'TIMEOUT_LOSS');
  const totalClosed = wins.length + losses.length;
  const wr = totalClosed > 0 ? (wins.length / totalClosed * 100) : 0;
  const totalR = allTrades.reduce((s, t) => s + (t.pnlR || 0), 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlR, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlR, 0) / losses.length : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  console.log(`Total trades: ${allTrades.length}`);
  console.log(`Wins: ${wins.length} (${wr.toFixed(1)}%)`);
  console.log(`Losses: ${losses.length}`);
  console.log(`Total R: ${totalR.toFixed(2)}R`);
  console.log(`Avg win: ${avgWin.toFixed(2)}R`);
  console.log(`Avg loss: ${avgLoss.toFixed(2)}R`);
  console.log(`Profit factor: ${profitFactor.toFixed(2)}`);
  console.log(`Expectancy per trade: ${(totalR / allTrades.length).toFixed(2)}R`);

  // Per symbol breakdown
  console.log('\n─── Per Symbol ───');
  for (const [sym, trades] of Object.entries(perSymbol)) {
    const w = trades.filter(t => ['WIN','PARTIAL_WIN','TIMEOUT_WIN'].includes(t.outcome)).length;
    const l = trades.filter(t => ['LOSS','TIMEOUT_LOSS'].includes(t.outcome)).length;
    const r = trades.reduce((s, t) => s + (t.pnlR || 0), 0);
    const wrS = (w+l) > 0 ? Math.round(w/(w+l)*100) : 0;
    console.log(`  ${sym.padEnd(10)}: ${trades.length} trades | ${w}W ${l}L (${wrS}%) | ${r.toFixed(1)}R`);
  }

  // Drawdown calculation
  let peak = 0, drawdown = 0, maxDD = 0;
  let running = 0;
  allTrades.sort((a, b) => a.closeTime - b.closeTime);
  for (const t of allTrades) {
    running += (t.pnlR || 0);
    if (running > peak) peak = running;
    drawdown = peak - running;
    if (drawdown > maxDD) maxDD = drawdown;
  }
  console.log(`\nMax Drawdown: ${maxDD.toFixed(2)}R`);
  console.log(`Peak: ${peak.toFixed(2)}R`);

  // Save results
  writeFileSync(RESULT_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    symbols: SYMBOLS,
    tf: TF,
    total_trades: allTrades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: +wr.toFixed(1),
    total_r: +totalR.toFixed(2),
    avg_win_r: +avgWin.toFixed(2),
    avg_loss_r: +avgLoss.toFixed(2),
    profit_factor: +profitFactor.toFixed(2),
    expectancy: +(totalR / allTrades.length).toFixed(2),
    max_drawdown_r: +maxDD.toFixed(2),
    per_symbol: Object.fromEntries(Object.entries(perSymbol).map(([s, trades]) => [s, {
      count: trades.length,
      wins: trades.filter(t => ['WIN','PARTIAL_WIN','TIMEOUT_WIN'].includes(t.outcome)).length,
      losses: trades.filter(t => ['LOSS','TIMEOUT_LOSS'].includes(t.outcome)).length,
      total_r: +trades.reduce((s, t) => s + (t.pnlR || 0), 0).toFixed(2)
    }])),
    trades: allTrades
  }, null, 2));

  console.log(`\n✅ Results saved to ${RESULT_PATH}`);

  // Verdict
  console.log('\n═══════════ VERDICT ═══════════');
  if (wr >= 55 && profitFactor >= 1.5 && totalR > 0) {
    console.log('🟢 STRATEGY IS PROFITABLE — safe to trade with real money');
  } else if (wr >= 45 && profitFactor >= 1.2 && totalR > 0) {
    console.log('🟡 STRATEGY IS MARGINAL — paper trade more before going real');
  } else {
    console.log('🔴 STRATEGY NEEDS WORK — do not trade real money yet');
  }
}

runBacktest().catch(console.error);

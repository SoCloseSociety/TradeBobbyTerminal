#!/usr/bin/env node
// TradeBobby Auto-Scanner — runs every 4H, NO AI credits consumed
// This is pure JavaScript logic that applies the V5 rules mechanically
// Only calls Claude when something IMPORTANT happens (high confluence signal)

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path to the TradingView MCP Jackson installation.
// Override via env var: TV_MCP_DIR=/path/to/tradingview-mcp-jackson node auto-scan.js
const MCP_DIR = process.env.TV_MCP_DIR || join(process.env.HOME || '~', 'tradingview-mcp-jackson');
const PORTFOLIO_PATH = join(__dirname, '..', 'paper_portfolio.json');
const SCAN_PATH = join(__dirname, 'last_scan.json');
const LOG_PATH = join(__dirname, 'auto-scan.log');

const WATCHLIST = [
  // Commodities — PRIORITY (macro-driven)
  'XAGUSD', 'XAUUSD', 'USOIL', 'UKOIL',
  // Crypto
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD',
  // Forex
  'EURUSD', 'GBPUSD', 'GBPJPY', 'USDJPY',
  // Indices
  'NAS100', 'SPX500', 'DAX', 'CAC40'
];

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

function cli(cmd) {
  try {
    const out = execSync(`cd ${MCP_DIR} && node src/cli/index.js ${cmd}`, {
      timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(out);
  } catch { return null; }
}

function sleep(ms) { execSync(`sleep ${ms / 1000}`); }

// ─── RULES ENGINE (pure JS, no AI needed) ───
// These are the V5 ICT rules coded as simple checks

function analyzeSetup(sym, data4H, data1H, price) {
  const alerts = [];
  const d = data4H;
  if (!d.Structure || !d['HTF (D)']) return { alerts, score: 0 };

  const struct = d.Structure;
  const htf = d['HTF (D)'];
  const zone = d.Zone || '';
  const mtf = d['MTF (D/4H/cur)'] || '';
  const conf = parseInt((d.Confluence || '0').split('/')[0]) || 0;
  const conv = d.Conviction || '—';
  const signal = d.Signal || 'NONE';

  // Score the setup
  let score = 0;
  let direction = '';

  // MTF fully aligned = strong
  if (mtf.includes('BULL')) { score += 3; direction = 'LONG'; }
  if (mtf.includes('BEAR')) { score += 3; direction = 'SHORT'; }

  // Structure + HTF agree
  if (struct.includes('BULL') && htf.includes('BULL')) { score += 2; direction = direction || 'LONG'; }
  if (struct.includes('BEAR') && htf.includes('BEAR')) { score += 2; direction = direction || 'SHORT'; }

  // Correct zone
  if (direction === 'LONG' && zone.includes('DISCOUNT')) score += 2;
  if (direction === 'SHORT' && zone.includes('PREMIUM')) score += 2;

  // OTE bonus
  if (zone.includes('OTE')) score += 1;

  // Confluence from V5
  score += Math.min(conf, 5);

  // Conviction
  if (conv === 'HIGH' || conv === 'VERY HIGH') score += 2;

  // ─── ALERTS ───

  // High confluence alert
  if (conf >= 5) {
    alerts.push(`🔥 HIGH CONFLUENCE ${sym}: ${conf}/10 ${direction}`);
  }

  // New signal appeared
  if (signal !== 'NONE' && !signal.includes('(')) {
    alerts.push(`📊 SIGNAL ${sym}: ${signal}`);
  }

  // MTF perfect alignment
  if (mtf.includes('BULL') || mtf.includes('BEAR')) {
    alerts.push(`✅ MTF ALIGNED ${sym}: ${mtf}`);
  }

  // Structure + HTF disagree = warning
  if ((struct.includes('BULL') && htf.includes('BEAR')) || (struct.includes('BEAR') && htf.includes('BULL'))) {
    alerts.push(`⚠️ DIVERGENCE ${sym}: struct=${struct} htf=${htf}`);
  }

  return { alerts, score, direction, conf, zone, struct, htf, mtf, conv, signal };
}

function checkPortfolio(priceMap) {
  if (!existsSync(PORTFOLIO_PATH)) return null;
  const pf = JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8'));
  const alerts = [];

  // Check open positions (skip already closed)
  for (const pos of pf.open_positions) {
    // Skip already closed positions
    if (['TP2_HIT','SL_HIT','CLOSED'].includes(pos.status)) continue;

    const price = priceMap[pos.symbol];
    if (!price) continue;

    const isLong = pos.direction === 'LONG';
    const pnlPts = isLong ? price - pos.entry : pos.entry - price;
    const riskDist = isLong ? pos.entry - pos.sl : pos.sl - pos.entry;
    const rr = riskDist > 0 ? pnlPts / riskDist : 0;

    // SL hit
    if ((isLong && price <= pos.sl) || (!isLong && price >= pos.sl)) {
      alerts.push(`🔴 SL HIT ${pos.symbol} ${pos.direction} @ ${pos.entry} → ${price} (${pos.tp1_hit ? 'partial win' : 'LOSS'})`);
      pos.status = 'SL_HIT';
      // Calculate P&L: if TP1 was hit, net positive (~+0.5R = +$50). Otherwise full loss (-$100)
      const slPnl = pos.tp1_hit ? 50 : -100;
      pf.account.balance += slPnl;
      pos.close_pnl = slPnl;
    }
    // TP2 hit
    else if ((isLong && price >= pos.tp2) || (!isLong && price <= pos.tp2)) {
      alerts.push(`🟢 TP2 HIT ${pos.symbol} ${pos.direction} @ ${pos.entry} → ${price} (FULL WIN)`);
      pos.status = 'TP2_HIT';
      // Full win: TP1 50% @ 1R + TP2 50% @ 2R = 1.5R avg = +$150
      const tp2Pnl = pos.tp1_hit ? 150 : 200;
      pf.account.balance += tp2Pnl;
      pos.close_pnl = tp2Pnl;
      pf.stats.wins = (pf.stats.wins || 0) + 1;
    }
    // TP1 hit
    else if (!pos.tp1_hit && ((isLong && price >= pos.tp1) || (!isLong && price <= pos.tp1))) {
      alerts.push(`🟡 TP1 HIT ${pos.symbol} ${pos.direction} @ ${pos.entry} — take 50% profit, trail rest`);
      pos.tp1_hit = true;
      pos.status = 'TP1_HIT_TRAILING';
      // TP1 partial profit: 50% @ 1R = +$50
      pf.account.balance += 50;
      pos.tp1_pnl = 50;
      pf.stats.partials = (pf.stats.partials || 0) + 1;
    }
    // Status update + proximity alerts
    else {
      const emoji = rr >= 1 ? '🟢' : rr >= 0 ? '🟡' : '🔴';
      log(`  ${emoji} ${pos.symbol} ${pos.direction} @ ${pos.entry}: now ${price} (${rr.toFixed(1)}R)`);

      // Near SL warning (within 20% of SL distance)
      const slDist = isLong ? price - pos.sl : pos.sl - price;
      const totalSLDist = isLong ? pos.entry - pos.sl : pos.sl - pos.entry;
      if (slDist > 0 && slDist < totalSLDist * 0.2) {
        alerts.push(`⚠️ ${pos.symbol} PROCHE DU SL: price ${price} → SL ${pos.sl} (${((slDist/totalSLDist)*100).toFixed(0)}% marge restante)`);
      }

      // Near TP1 (within 20% of TP1 distance from current)
      if (!pos.tp1_hit) {
        const tp1Dist = isLong ? pos.tp1 - price : price - pos.tp1;
        const totalTp1Dist = isLong ? pos.tp1 - pos.entry : pos.entry - pos.tp1;
        if (tp1Dist > 0 && tp1Dist < totalTp1Dist * 0.2) {
          alerts.push(`🎯 ${pos.symbol} PROCHE DE TP1: price ${price} → TP1 ${pos.tp1} (${((1 - tp1Dist/totalTp1Dist)*100).toFixed(0)}% atteint)`);
        }
      }
      // Near TP2 (after TP1 hit)
      if (pos.tp1_hit) {
        const tp2Dist = isLong ? pos.tp2 - price : price - pos.tp2;
        const totalTp2Dist = isLong ? pos.tp2 - pos.tp1 : pos.tp1 - pos.tp2;
        if (tp2Dist > 0 && tp2Dist < totalTp2Dist * 0.2) {
          alerts.push(`🎯 ${pos.symbol} PROCHE DE TP2: price ${price} → TP2 ${pos.tp2}`);
        }
      }
    }
  }

  // Check pending orders — trigger or expire
  const today = new Date().toISOString().split('T')[0];
  for (const order of pf.pending_orders) {
    // Expire orders past their date
    if (order.expires && order.expires < today) {
      alerts.push(`⏰ EXPIRED ${order.symbol} ${order.direction} @ ${order.entry} — order expired ${order.expires}`);
      order.status = 'EXPIRED';
      continue;
    }

    const price = priceMap[order.symbol];
    if (!price) continue;

    if (order.direction === 'LONG' && price <= order.entry) {
      alerts.push(`📥 LIMIT TRIGGERED ${order.symbol} LONG @ ${order.entry}`);
      order.status = 'TRIGGERED';
    }
    if (order.direction === 'SHORT' && price >= order.entry) {
      alerts.push(`📥 LIMIT TRIGGERED ${order.symbol} SHORT @ ${order.entry}`);
      order.status = 'TRIGGERED';
    }
  }
  // Remove expired orders
  pf.pending_orders = pf.pending_orders.filter(o => o.status !== 'EXPIRED');

  // ── RECALCULATE STATS (fix bug: total_pnl, peak, win_rate were desynced) ──
  if (!pf.stats) pf.stats = {};
  const initial = pf.account?.initial_balance || 10000;
  pf.stats.total_pnl = +(pf.account.balance - initial).toFixed(2);
  pf.stats.peak_balance = Math.max(pf.stats.peak_balance || initial, pf.account.balance);
  pf.stats.max_drawdown = +(pf.stats.peak_balance - pf.account.balance).toFixed(2);
  // Count total_trades as non-pending positions with a finalized status or a partial
  const allPos = [...(pf.open_positions || []), ...(pf.closed_trades || [])];
  const finalStatuses = ['TP2_HIT','SL_HIT','CLOSED','TP1_HIT_TRAILING','OPEN'];
  pf.stats.total_trades = allPos.filter(p => finalStatuses.includes(p.status)).length;
  // Win rate among completed trades only (TP2, partials, SL)
  const wins = pf.stats.wins || 0;
  const losses = pf.stats.losses || 0;
  const partials = pf.stats.partials || 0;
  const completed = wins + losses; // partials alone aren't final, but don't count as loss
  pf.stats.win_rate = completed > 0 ? Math.round((wins / completed) * 100) : (wins > 0 ? 100 : 0);
  pf.stats.best_trade = Math.max(pf.stats.best_trade || 0, ...allPos.map(p => p.close_pnl || 0));
  pf.stats.worst_trade = Math.min(pf.stats.worst_trade || 0, ...allPos.map(p => p.close_pnl || 0));

  writeFileSync(PORTFOLIO_PATH, JSON.stringify(pf, null, 2));
  return alerts;
}

async function run() {
  log('═══ AUTO-SCAN START ═══');

  const allAlerts = [];
  const scans = [];
  const priceMap = {};

  for (const sym of WATCHLIST) {
    cli(`symbol ${sym}`);
    sleep(1500);

    const quote = cli('quote');
    const price = quote?.last || quote?.close || null;
    priceMap[sym] = price;

    const data = {};
    for (const tf of ['60', '240']) {
      cli(`timeframe ${tf}`);
      sleep(2000);
      const tables = cli('data tables');
      if (tables?.studies?.[0]?.tables?.[0]) {
        const o = {};
        tables.studies[0].tables[0].rows.forEach(row => {
          const p = row.split('|');
          if (p.length === 2) o[p[0].trim()] = p[1].trim();
        });
        data[tf] = o;
      }
    }

    const analysis = analyzeSetup(sym, data['240'] || {}, data['60'] || {}, price);
    allAlerts.push(...analysis.alerts);

    scans.push({
      symbol: sym, price,
      tf_60: data['60'] || {},
      tf_240: data['240'] || {},
      score: analysis.score,
      direction: analysis.direction
    });

    log(`  ${sym}: ${price} | score=${analysis.score} | ${analysis.direction || 'FLAT'} | ${analysis.struct}/${analysis.htf}`);
  }

  // Check portfolio
  const pfAlerts = checkPortfolio(priceMap);
  if (pfAlerts) allAlerts.push(...pfAlerts);

  // Sort by score — best setups first
  scans.sort((a, b) => b.score - a.score);

  // ── PRESERVE LAST GOOD SCAN if this one has no study data (MCP offline) ──
  const symbolsWithData = scans.filter(s => s.tf_240 && Object.keys(s.tf_240).length > 0).length;
  const totalSyms = scans.length;
  const dataQuality = totalSyms > 0 ? symbolsWithData / totalSyms : 0;

  if (dataQuality < 0.3 && existsSync(SCAN_PATH)) {
    log(`⚠️ Only ${symbolsWithData}/${totalSyms} symbols have study data (MCP offline?) — merging with last good scan`);
    const prev = JSON.parse(readFileSync(SCAN_PATH, 'utf8'));
    const prevMap = {};
    (prev.symbols || []).forEach(s => { prevMap[s.symbol] = s; });
    // For symbols with no new study data, fall back to previous scan's study data
    scans.forEach(s => {
      if ((!s.tf_240 || Object.keys(s.tf_240).length === 0) && prevMap[s.symbol]) {
        s.tf_240 = prevMap[s.symbol].tf_240;
        s.tf_60 = prevMap[s.symbol].tf_60;
        s.stale = true; // mark as stale
      }
    });
  }

  // Save scan result
  const result = {
    timestamp: new Date().toISOString(),
    data_quality: +(dataQuality * 100).toFixed(0),
    mcp_status: dataQuality < 0.3 ? 'OFFLINE' : dataQuality < 0.8 ? 'DEGRADED' : 'OK',
    symbols: scans,
    alerts: allAlerts,
    top_setups: scans.filter(s => s.score >= 6).map(s => `${s.symbol} ${s.direction} (score ${s.score})`),
    portfolio: JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8'))
  };

  writeFileSync(SCAN_PATH, JSON.stringify(result, null, 2));

  // Auto-feed feedback.json — only NEW alerts (deduplicate)
  const fbPath = join(__dirname, 'feedback.json');
  const fb = existsSync(fbPath) ? JSON.parse(readFileSync(fbPath, 'utf8')) : { notes: [] };

  // Get recent note texts (last 24h) to avoid duplicates
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentTexts = new Set(
    fb.notes
      .filter(n => n.source === 'AUTO-SCAN' && new Date(n.timestamp).getTime() > recentCutoff)
      .map(n => n.text)
  );

  // Only log alerts not seen in last 24h
  for (const alert of allAlerts) {
    if (recentTexts.has(alert)) continue;
    fb.notes.push({
      type: alert.includes('DIVERGENCE') ? 'bug' : alert.includes('MTF') ? 'idea' : 'trade',
      text: alert,
      symbol: '',
      source: 'AUTO-SCAN',
      timestamp: new Date().toISOString()
    });
  }

  // Snapshot portfolio balance for performance chart
  const perfPath = join(__dirname, 'performance.json');
  let perf = existsSync(perfPath) ? JSON.parse(readFileSync(perfPath, 'utf8')) : { snapshots: [] };
  const pfNow = JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8'));

  // Calculate unrealized P&L
  let unrealized = 0;
  for (const pos of pfNow.open_positions || []) {
    const p = priceMap[pos.symbol];
    if (!p) continue;
    const isLong = pos.direction === 'LONG';
    const pnlPts = isLong ? p - pos.entry : pos.entry - p;
    const riskDist = isLong ? pos.entry - pos.sl : pos.sl - pos.entry;
    if (riskDist > 0) {
      // Scale: 100$ per 1R (since risk per trade = $100)
      const posSize = (pos.remaining_pct || 100) / 100;
      unrealized += (pnlPts / riskDist) * 100 * posSize;
    }
  }

  perf.snapshots.push({
    timestamp: new Date().toISOString(),
    balance: pfNow.account.balance,
    unrealized: Math.round(unrealized * 100) / 100,
    total: Math.round((pfNow.account.balance + unrealized) * 100) / 100,
    open_positions: pfNow.open_positions.length,
    pending_orders: pfNow.pending_orders.length
  });
  if (perf.snapshots.length > 100) perf.snapshots = perf.snapshots.slice(-100);
  writeFileSync(perfPath, JSON.stringify(perf, null, 2));

  // Log scan summary (always, but compact)
  fb.notes.push({
    type: 'idea',
    text: `SCAN: ${scans.length} symbols | Top: ${result.top_setups.join(', ') || 'none'} | Portfolio: $${result.portfolio.account.balance.toFixed(2)}`,
    source: 'AUTO-SCAN',
    timestamp: new Date().toISOString()
  });

  // Keep only last 200 notes
  if (fb.notes.length > 200) fb.notes = fb.notes.slice(-200);
  writeFileSync(fbPath, JSON.stringify(fb, null, 2));

  // Generate fresh setups
  try {
    const { generateSetups } = await import('./generate-setups.js');
    generateSetups();
    log('Setups generated');
  } catch(e) { log('Setup generation skipped: ' + e.message); }

  // Print summary
  log('');
  log('═══ SUMMARY ═══');
  log(`Top setups: ${result.top_setups.length > 0 ? result.top_setups.join(', ') : 'None above threshold'}`);

  if (allAlerts.length > 0) {
    log('');
    log('═══ ALERTS ═══');
    allAlerts.forEach(a => log(a));
  } else {
    log('No alerts — market quiet');
  }

  log('═══ AUTO-SCAN COMPLETE ═══');
  return { alerts: allAlerts, top: result.top_setups };
}

run().catch(e => log(`ERROR: ${e.message}`));

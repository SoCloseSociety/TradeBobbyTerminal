// TradeBobby Scanner — reads V5 data from all watchlist symbols via MCP CLI
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadWatchlist } from './load-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path to the TradingView MCP Jackson installation.
// Override via env var: TV_MCP_DIR=/path/to/tradingview-mcp-jackson node scan.js
const MCP_DIR = process.env.TV_MCP_DIR || join(process.env.HOME || '~', 'tradingview-mcp-jackson');
const PORTFOLIO_PATH = join(__dirname, '..', 'paper_portfolio.json');
const SCAN_PATH = join(__dirname, 'last_scan.json');

// Watchlist comes from rules.json (single source of truth); fallback if unreadable.
const WATCHLIST = loadWatchlist(['XAUUSD','EURUSD','GBPUSD','USDJPY','NAS100','SPX500','US30','DAX','NVDA','AAPL','TSLA','QQQ']);

function cli(cmd) {
  try {
    const out = execSync(`cd ${MCP_DIR} && node src/cli/index.js ${cmd}`, {
      timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(out);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

async function scanSymbol(sym) {
  cli(`symbol ${sym}`);
  sleep(1500);

  const quote = cli('quote');
  const price = quote.last || quote.close || null;

  const results = {};
  for (const tf of ['60', '240']) {
    cli(`timeframe ${tf}`);
    sleep(2000);
    const tables = cli('data tables');
    if (tables.studies && tables.studies[0] && tables.studies[0].tables[0]) {
      const rows = tables.studies[0].tables[0].rows;
      const o = {};
      rows.forEach(row => {
        const p = row.split('|');
        if (p.length === 2) o[p[0].trim()] = p[1].trim();
      });
      results[tf] = o;
    }
  }

  return { symbol: sym, price, tf_60: results['60'] || {}, tf_240: results['240'] || {} };
}

async function checkPortfolio(scans) {
  const portfolio = JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8'));
  const priceMap = {};
  scans.forEach(s => { priceMap[s.symbol] = s.price; });

  // Check pending orders
  for (const order of portfolio.pending_orders) {
    const price = priceMap[order.symbol];
    if (!price) continue;

    if (order.direction === 'LONG' && price <= order.entry) {
      // Limit order triggered
      order.status = 'TRIGGERED';
      portfolio.open_positions.push({
        ...order,
        status: 'OPEN',
        open_date: new Date().toISOString().split('T')[0],
        tp1_hit: false,
        tp1_pnl: 0,
        remaining_pct: 100
      });
    }
    if (order.direction === 'SHORT' && price >= order.entry) {
      order.status = 'TRIGGERED';
      portfolio.open_positions.push({
        ...order,
        status: 'OPEN',
        open_date: new Date().toISOString().split('T')[0],
        tp1_hit: false,
        tp1_pnl: 0,
        remaining_pct: 100
      });
    }
  }
  portfolio.pending_orders = portfolio.pending_orders.filter(o => o.status === 'PENDING');

  // Check open positions for TP/SL
  for (const pos of portfolio.open_positions) {
    const price = priceMap[pos.symbol];
    if (!price || pos.status === 'CLOSED') continue;

    if (pos.direction === 'LONG') {
      if (price <= pos.sl) {
        pos.status = 'CLOSED';
        const pnl = pos.tp1_hit ? pos.tp1_pnl : -(pos.size_usd);
        pos.close_pnl = pnl;
        portfolio.account.balance += pnl;
        portfolio.stats[pos.tp1_hit ? 'partials' : 'losses'] += 1;
      } else if (price >= pos.tp2 && !pos.tp2_hit) {
        pos.status = 'CLOSED';
        const riskDist = pos.entry - pos.sl;
        const pnl = pos.tp1_hit
          ? pos.tp1_pnl + (pos.size_usd * 0.5 * (pos.tp2 - pos.entry) / riskDist)
          : pos.size_usd * (pos.tp2 - pos.entry) / riskDist;
        pos.close_pnl = pnl;
        portfolio.account.balance += pnl;
        portfolio.stats.wins += 1;
      } else if (price >= pos.tp1 && !pos.tp1_hit) {
        pos.tp1_hit = true;
        const riskDist = pos.entry - pos.sl;
        pos.tp1_pnl = pos.size_usd * 0.5 * (pos.tp1 - pos.entry) / riskDist;
        pos.remaining_pct = 50;
        pos.status = 'TP1_HIT_TRAILING';
        portfolio.account.balance += pos.tp1_pnl;
        portfolio.stats.partials += 1;
      }
    } else if (pos.direction === 'SHORT') {
      if (price >= pos.sl) {
        pos.status = 'CLOSED';
        const pnl = pos.tp1_hit ? pos.tp1_pnl : -(pos.size_usd);
        pos.close_pnl = pnl;
        portfolio.account.balance += pnl;
        portfolio.stats[pos.tp1_hit ? 'partials' : 'losses'] += 1;
      } else if (price <= pos.tp2) {
        pos.status = 'CLOSED';
        const riskDist = pos.sl - pos.entry;
        const pnl = pos.tp1_hit
          ? pos.tp1_pnl + (pos.size_usd * 0.5 * (pos.entry - pos.tp2) / riskDist)
          : pos.size_usd * (pos.entry - pos.tp2) / riskDist;
        pos.close_pnl = pnl;
        portfolio.account.balance += pnl;
        portfolio.stats.wins += 1;
      } else if (price <= pos.tp1 && !pos.tp1_hit) {
        pos.tp1_hit = true;
        const riskDist = pos.sl - pos.entry;
        pos.tp1_pnl = pos.size_usd * 0.5 * (pos.entry - pos.tp1) / riskDist;
        pos.remaining_pct = 50;
        pos.status = 'TP1_HIT_TRAILING';
        portfolio.account.balance += pos.tp1_pnl;
        portfolio.stats.partials += 1;
      }
    }
  }

  // Move closed to history
  const closed = portfolio.open_positions.filter(p => p.status === 'CLOSED');
  portfolio.closed_trades.push(...closed);
  portfolio.open_positions = portfolio.open_positions.filter(p => p.status !== 'CLOSED');

  // Update stats
  portfolio.stats.total_trades = portfolio.closed_trades.length + portfolio.open_positions.length;
  portfolio.stats.total_pnl = portfolio.account.balance - portfolio.account.initial_balance;
  portfolio.stats.peak_balance = Math.max(portfolio.stats.peak_balance, portfolio.account.balance);
  portfolio.stats.max_drawdown = Math.max(
    portfolio.stats.max_drawdown,
    portfolio.stats.peak_balance - portfolio.account.balance
  );
  const totalClosed = portfolio.stats.wins + portfolio.stats.losses + portfolio.stats.partials;
  portfolio.stats.win_rate = totalClosed > 0 ? Math.round((portfolio.stats.wins + portfolio.stats.partials) / totalClosed * 100) : 0;

  writeFileSync(PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2));
  return portfolio;
}

async function run() {
  console.log('🔄 TradeBobby Scanner starting...');
  console.log(`📊 Scanning ${WATCHLIST.length} symbols...`);

  const scans = [];
  for (const sym of WATCHLIST) {
    process.stdout.write(`  ${sym}... `);
    const result = await scanSymbol(sym);
    scans.push(result);
    console.log(`${result.price} ✓`);
  }

  console.log('\n💼 Checking portfolio...');
  const portfolio = await checkPortfolio(scans);

  const scanResult = {
    timestamp: new Date().toISOString(),
    symbols: scans,
    portfolio: {
      balance: portfolio.account.balance,
      pnl: portfolio.stats.total_pnl,
      open_positions: portfolio.open_positions.length,
      pending_orders: portfolio.pending_orders.length,
      win_rate: portfolio.stats.win_rate,
      wins: portfolio.stats.wins,
      losses: portfolio.stats.losses,
      partials: portfolio.stats.partials
    }
  };

  writeFileSync(SCAN_PATH, JSON.stringify(scanResult, null, 2));
  console.log(`\n✅ Scan complete. Balance: $${portfolio.account.balance.toFixed(2)} (${portfolio.stats.total_pnl >= 0 ? '+' : ''}$${portfolio.stats.total_pnl.toFixed(2)})`);
  console.log(`📈 Record: ${portfolio.stats.wins}W ${portfolio.stats.losses}L ${portfolio.stats.partials}P (${portfolio.stats.win_rate}%)`);
  console.log(`📁 Saved to ${SCAN_PATH}`);
}

run().catch(console.error);

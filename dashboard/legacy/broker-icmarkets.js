// ── ICMarkets broker integration ──
// Supports 3 modes:
//   1. MetaApi.cloud (MT5) - RECOMMENDED, works on Mac, free tier
//   2. cTrader Open API     - if you have a cTrader account at ICM
//   3. Mock / manual        - fallback
//
// Setup MetaApi.cloud (no credentials committed):
//   export MT_ACCOUNT_ID="..."          # MetaApi account ID
//   export MT_API_TOKEN="..."           # MetaApi auth token
//   export BROKER_MODE="metaapi"        # or "ctrader" / "mock"
//
// Run: node broker-icmarkets.js
// Writes live positions to broker_positions.json every 30s.

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POS_PATH = join(__dirname, 'broker_positions.json');
const LOG_PATH = join(__dirname, 'broker-icmarkets.log');

const MODE = process.env.BROKER_MODE || 'mock';
const MT_ACCOUNT_ID = process.env.MT_ACCOUNT_ID || '';
const MT_API_TOKEN = process.env.MT_API_TOKEN || '';
const META_REGION = process.env.MT_REGION || 'new-york'; // metaapi region

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

// ── MetaApi REST client (no SDK, pure fetch) ──
async function metaapiFetch(path, opts = {}) {
  const url = `https://mt-client-api-v1.${META_REGION}.agiliumtrade.ai${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'auth-token': MT_API_TOKEN,
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`MetaApi ${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function getMetaApiPositions() {
  if (!MT_ACCOUNT_ID || !MT_API_TOKEN) {
    throw new Error('Missing MT_ACCOUNT_ID or MT_API_TOKEN env vars');
  }
  const positions = await metaapiFetch(`/users/current/accounts/${MT_ACCOUNT_ID}/positions`);
  const orders = await metaapiFetch(`/users/current/accounts/${MT_ACCOUNT_ID}/orders`);
  const info = await metaapiFetch(`/users/current/accounts/${MT_ACCOUNT_ID}/account-information`);
  return {
    balance: info.balance,
    equity: info.equity,
    margin: info.margin,
    freeMargin: info.freeMargin,
    currency: info.currency,
    leverage: info.leverage,
    positions: positions.map(p => ({
      id: p.id,
      symbol: p.symbol,
      direction: p.type?.includes('BUY') ? 'LONG' : 'SHORT',
      volume: p.volume,
      entry: p.openPrice,
      current: p.currentPrice,
      sl: p.stopLoss,
      tp: p.takeProfit,
      profit: p.profit,
      swap: p.swap,
      commission: p.commission,
      opened: p.time,
      comment: p.comment
    })),
    orders: orders.map(o => ({
      id: o.id,
      symbol: o.symbol,
      type: o.type,
      volume: o.volume,
      price: o.openPrice,
      sl: o.stopLoss,
      tp: o.takeProfit
    }))
  };
}

// ── cTrader Open API placeholder ──
async function getCtraderPositions() {
  throw new Error('cTrader Open API not yet implemented. Requires OAuth flow.');
}

// ── MOCK mode (reads real_trades.json for demo) ──
async function getMockPositions() {
  const rtPath = join(__dirname, 'real_trades.json');
  if (!existsSync(rtPath)) return { balance: 0, positions: [], orders: [], note: 'MOCK: no real_trades.json' };
  const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
  const open = (rt.trades || []).filter(t => t.status === 'OPEN');
  const mockBalance = parseFloat(process.env.MOCK_BALANCE || '10000');
  return {
    balance: mockBalance,
    equity: mockBalance,
    margin: 0,
    freeMargin: mockBalance,
    currency: process.env.MOCK_CURRENCY || 'USD',
    leverage: parseInt(process.env.MOCK_LEVERAGE || '100', 10),
    note: 'MOCK mode: derived from real_trades.json (set BROKER_MODE=metaapi with real creds to go live)',
    positions: open.map(t => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      volume: t.size || 0.01,
      entry: t.entry,
      current: t.entry, // no live price in mock
      sl: t.sl,
      tp: t.tp,
      profit: 0,
      swap: 0,
      commission: 0,
      opened: t.opened,
      comment: t.note || ''
    })),
    orders: []
  };
}

// ── MAIN LOOP ──
async function fetchPositions() {
  try {
    let data;
    if (MODE === 'metaapi') {
      log(`Fetching from MetaApi.cloud (account ${MT_ACCOUNT_ID.substring(0, 8)}...)`);
      data = await getMetaApiPositions();
    } else if (MODE === 'ctrader') {
      data = await getCtraderPositions();
    } else {
      data = await getMockPositions();
    }
    const output = {
      mode: MODE,
      timestamp: new Date().toISOString(),
      ...data
    };
    writeFileSync(POS_PATH, JSON.stringify(output, null, 2));
    log(`OK: ${data.positions?.length || 0} positions, bal=${data.balance} ${data.currency||'USD'}`);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    // Keep last known state — do not overwrite with error
  }
}

// Run once, then every 30s if invoked as daemon
const daemon = process.argv.includes('--daemon');

await fetchPositions();

if (daemon) {
  log(`Daemon mode: polling every 30s (mode=${MODE})`);
  setInterval(fetchPositions, 30000);
}

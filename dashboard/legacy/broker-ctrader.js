// ── cTrader Open API client for ICMarkets ──
// Uses cTrader Open API (https://openapi.ctrader.com) via HTTP REST + OAuth2
// Writes live positions to broker_positions.json every 30s
//
// ── SETUP (~5 min) ──
// 1. Go to https://connect.spotware.com/apps → register a new app
//    - Type: "Public" (or "Private" if you prefer self-hosted)
//    - Redirect URI: http://localhost:8888/callback
//    - Scope: "trading" (required for positions) + "accounts"
// 2. Copy your client_id + client_secret
// 3. Export env vars:
//      export CTRADER_CLIENT_ID="..."
//      export CTRADER_CLIENT_SECRET="..."
//      export CTRADER_ACCOUNT_ID="..."         # your cTID account id (found in cTrader Mobile → Manage accounts)
// 4. Run this script: node broker-ctrader.js
//    - First run prints an auth URL; open it in browser, login, authorize
//    - It catches the callback, exchanges code for access_token, saves to broker-ctrader-tokens.json
//    - Subsequent runs use the saved refresh_token automatically
//
// NOTE on ICMarkets cTrader accounts:
//   - ICMarkets cTrader Live IDs start with 1xxxxxxx (8 digits)
//   - Demo IDs start with 2xxxxxxx
//   - You find them in cTrader Desktop → top-left dropdown

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POS_PATH = join(__dirname, 'broker_positions.json');
const TOKENS_PATH = join(__dirname, 'broker-ctrader-tokens.json');
const LOG_PATH = join(__dirname, 'broker-ctrader.log');

const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';
const ACCOUNT_ID = process.env.CTRADER_ACCOUNT_ID || '';
const REDIRECT_URI = 'http://localhost:8888/callback';
const AUTH_BASE = 'https://connect.spotware.com';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

function loadTokens() {
  if (!existsSync(TOKENS_PATH)) return null;
  return JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
}
function saveTokens(t) {
  writeFileSync(TOKENS_PATH, JSON.stringify(t, null, 2));
  try { require('fs').chmodSync(TOKENS_PATH, 0o600); } catch {}
}

// ── OAUTH2 FLOW (authorization code) ──
async function authorize() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Set CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET env vars');

  const authUrl = `${AUTH_BASE}/apps/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=trading+accounts`;
  log('');
  log('══════════════════════════════════════════════════════════');
  log(' cTrader Open API - Authorization required');
  log('══════════════════════════════════════════════════════════');
  log(' Open this URL in your browser:');
  log('');
  log('   ' + authUrl);
  log('');
  log(' After login, you will be redirected to localhost:8888');
  log('══════════════════════════════════════════════════════════');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost:8888');
      const c = u.searchParams.get('code');
      if (c) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1 style="font-family:monospace;color:#00E676;background:#000;padding:40px;">cTrader authorized ✓</h1><p style="font-family:monospace;color:#fff;background:#000;padding:0 40px 40px;">You can close this tab. Return to terminal.</p>');
        server.close();
        resolve(c);
      } else {
        res.writeHead(400); res.end('Missing code');
        server.close();
        reject(new Error('No code in callback'));
      }
    });
    server.listen(8888);
    setTimeout(() => { server.close(); reject(new Error('OAuth timeout (5min)')); }, 300000);
  });

  const tokenRes = await fetch(`${AUTH_BASE}/apps/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  if (!tokenRes.ok) throw new Error('Token exchange failed: ' + tokenRes.status + ' ' + await tokenRes.text());
  const tok = await tokenRes.json();
  tok.obtained = new Date().toISOString();
  saveTokens(tok);
  log('✓ Authorization complete. Tokens saved.');
  return tok;
}

async function refreshAccessToken(tokens) {
  const res = await fetch(`${AUTH_BASE}/apps/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  if (!res.ok) throw new Error('Refresh failed: ' + res.status);
  const nt = await res.json();
  nt.obtained = new Date().toISOString();
  if (!nt.refresh_token) nt.refresh_token = tokens.refresh_token;
  saveTokens(nt);
  return nt;
}

async function ensureToken() {
  let tokens = loadTokens();
  if (!tokens) tokens = await authorize();
  else {
    const ageSec = (Date.now() - new Date(tokens.obtained).getTime()) / 1000;
    if (ageSec > (tokens.expires_in - 120)) {
      log('Access token expired, refreshing...');
      tokens = await refreshAccessToken(tokens);
    }
  }
  return tokens;
}

// ── cTrader API calls ──
async function ctApi(path, tokens) {
  const url = `${AUTH_BASE}/connect/tradingaccounts${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + tokens.access_token,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('ctApi ' + path + ' ' + res.status + ' ' + await res.text());
  return await res.json();
}

async function getPositions() {
  const tokens = await ensureToken();
  if (!ACCOUNT_ID) throw new Error('Set CTRADER_ACCOUNT_ID env var');

  // Note: Spotware's REST endpoint structure; positions are fetched per trading account
  const acc = await ctApi(`/${ACCOUNT_ID}`, tokens);
  const positions = await ctApi(`/${ACCOUNT_ID}/positions`, tokens);

  const mapDir = t => (t === 1 || t === 'BUY') ? 'LONG' : 'SHORT';
  const norm = (positions.positions || positions.data || positions || []).map(p => ({
    id: String(p.positionId || p.id || ''),
    symbol: p.symbolName || p.symbol,
    direction: mapDir(p.tradeSide || p.type),
    volume: (p.volume || 0) / 100, // cTrader returns in cents of lots
    entry: p.entryPrice || p.price,
    current: p.currentPrice || p.entryPrice,
    sl: p.stopLoss || null,
    tp: p.takeProfit || null,
    profit: p.grossProfit || p.pnl || 0,
    swap: p.swap || 0,
    commission: p.commission || 0,
    opened: p.openTimestamp ? new Date(p.openTimestamp).toISOString() : null,
    comment: p.comment || ''
  }));

  return {
    balance: acc.balance || acc.accountData?.balance || 0,
    equity: acc.equity || acc.accountData?.equity || 0,
    margin: acc.totalMarginUsed || 0,
    freeMargin: acc.freeMargin || 0,
    currency: acc.depositCurrency || acc.currency || 'USD',
    leverage: acc.leverage || 1,
    positions: norm,
    orders: [] // pending orders would be fetched from /orders
  };
}

async function fetchPositions() {
  try {
    const data = await getPositions();
    writeFileSync(POS_PATH, JSON.stringify({
      mode: 'ctrader',
      timestamp: new Date().toISOString(),
      ...data
    }, null, 2));
    log(`OK: ${data.positions.length} positions, bal=${data.balance} ${data.currency}`);
  } catch (e) {
    log('ERROR: ' + e.message);
  }
}

const daemon = process.argv.includes('--daemon');
await fetchPositions();
if (daemon) {
  log(`Daemon: polling every 30s`);
  setInterval(fetchPositions, 30000);
}

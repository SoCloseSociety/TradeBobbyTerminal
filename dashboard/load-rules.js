// Shared loader: the engine's rules.json is the SINGLE source of truth for the watchlist.
// Scanners must not hardcode markets (they used to trade crypto/oil that rules.json dropped).
// No em dashes by repo convention. Use "--".
import { readFileSync } from 'fs';
import { join } from 'path';

const MCP_DIR = process.env.TV_MCP_DIR || join(process.env.HOME || '~', 'tradingview-mcp-jackson');

// Strip exchange prefixes (OANDA:XAUUSD -> XAUUSD) and map OANDA index/CFD names to the
// bare tickers the scanners use (NAS100USD -> NAS100, DE30EUR -> DAX, etc.).
const NAME_MAP = { NAS100USD: 'NAS100', SPX500USD: 'SPX500', US30USD: 'US30', DE30EUR: 'DAX', UK100GBP: 'UK100', JP225USD: 'JP225' };
export function normalizeSymbol(s) {
  let sym = String(s);
  if (sym.includes(':')) sym = sym.split(':').pop();
  return NAME_MAP[sym] || sym;
}

function readRules() {
  return JSON.parse(readFileSync(join(MCP_DIR, 'rules.json'), 'utf8'));
}

// Tier-1 tradeable watchlist (rules.json watchlist.all), normalized + de-duped.
export function loadWatchlist(fallback = []) {
  try {
    const all = (readRules().watchlist && readRules().watchlist.all) || [];
    const syms = [...new Set(all.map(normalizeSymbol))];
    return syms.length ? syms : fallback;
  } catch (e) {
    return fallback;
  }
}

// Crypto is WATCH ONLY in rules.json: exposed separately so scanners can show it without
// generating live trade signals.
export function loadCryptoWatch() {
  try {
    const wl = readRules().watchlist || {};
    return [...new Set((wl.crypto_watch || []).map(normalizeSymbol))];
  } catch (e) {
    return [];
  }
}

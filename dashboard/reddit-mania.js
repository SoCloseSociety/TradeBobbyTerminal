// ── Reddit Retail Mania Scanner ──
// Scrapes r/wallstreetbets, r/CryptoCurrency, r/stocks for ticker mentions.
// Surfaces hot tickers (mention spike = retail attention = often contrarian).
//
// One-shot: node reddit-mania.js
// Daemon (every 30min): node reddit-mania.js --daemon

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic, readJsonSafe } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'reddit_mania.json');
const HISTORY = join(__dirname, 'reddit_mania_history.json');
const LOG = join(__dirname, 'reddit-mania.log');
const log = mkLogger(LOG);

const SUBS = [
  { name: 'wallstreetbets', limit: 50 },
  { name: 'stocks', limit: 30 },
  { name: 'CryptoCurrency', limit: 30 },
  { name: 'options', limit: 25 }
];

// Common false-positive words that look like tickers
const STOP_TICKERS = new Set([
  'A','I','M','S','U','X','TV','OK','DM','CEO','CFO','IPO','ETF','FOMO','YOLO',
  'AI','API','APR','AUG','BUY','BTW','CAD','EOD','EOY','EPS','EUR','FED','GBP',
  'IDK','IRA','IRS','JPY','JUL','JUN','LOL','MOM','NOV','OCT','OMG','SEC','SEP','TBH',
  'USD','USA','WSB','UI','UK','US','EU','PR','HR','PM','AM','OP','TLDR','EDIT',
  'YTD','ATH','ATL','MIA','BOJ','ECB','GDP','CPI','PCE','PPI','NEW','OLD','TOP','LOW',
  'HIGH','BIG','WIN','LOSS','GAIN','CALL','PUT','LONG','SHORT','BULL','BEAR','PUMP','DUMP',
  'GO','NO','YES','OUT','OFF','ON','UP','OWN','GET','BAD','RED','RIP','LFG','VS',
  'IT','ITS','IMO','LMK','ROI','ASAP','ESG','FUD','FYI','HQ','NFA','PSA','RH','SP',
  'OTC','CFD','DIP','FY','HOLD','SELL','BTFD','ROFL','HOPE','MOON','BAGS','PORN',
  'GME','AMC' // these are tickers but always-on, surface separately if needed
]);

const TICKER_RE = /\$?\b[A-Z]{2,5}\b/g;
const CRYPTO_RE = /\$?\b(BTC|ETH|SOL|XRP|DOGE|ADA|MATIC|LINK|AVAX|DOT|SUI|TON|ATOM|UNI|FIL|NEAR|APT|TIA)\b/g;

async function fetchSub(sub, limit) {
  // old.reddit.com is far less aggressive about blocking script user agents than www.
  const url = `https://old.reddit.com/r/${sub}/new.json?limit=${limit}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'tradebobby/1.0 (macOS; monitoring script)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      log(`  ⚠ r/${sub} HTTP ${r.status}`);
      return [];
    }
    const j = await r.json();
    return (j?.data?.children || []).map(c => c.data);
  } catch (e) {
    log(`  ⚠ r/${sub} fetch error: ${e.message}`);
    return [];
  }
}

function extractTickers(text) {
  if (!text) return [];
  const matches = text.match(TICKER_RE) || [];
  return matches
    .map(m => m.replace('$', ''))
    .filter(t => t.length >= 2 && t.length <= 5)
    .filter(t => !STOP_TICKERS.has(t));
}

async function run() {
  log('🔄 Scanning Reddit retail mania...');
  const counts = {};
  const recent = {};
  let totalPosts = 0;

  for (const s of SUBS) {
    const posts = await fetchSub(s.name, s.limit);
    posts.forEach(p => {
      totalPosts++;
      const text = (p.title || '') + ' ' + (p.selftext || '').substring(0, 300);
      const tickers = extractTickers(text);
      tickers.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
        if (!recent[t]) recent[t] = [];
        if (recent[t].length < 3) {
          recent[t].push({
            sub: s.name,
            title: p.title?.substring(0, 100),
            score: p.score,
            url: 'https://reddit.com' + p.permalink,
            created: p.created_utc
          });
        }
      });
    });
    await new Promise(r => setTimeout(r, 500)); // be polite
  }

  // All subs failed → keep previous mania data instead of writing fake zeros
  if (totalPosts === 0) {
    const prev = readJsonSafe(OUT, {});
    const out = {
      ...prev,
      timestamp: new Date().toISOString(),
      error: 'all subreddit fetches failed'
    };
    writeJsonAtomic(OUT, out);
    log('❌ All subreddit fetches failed — kept previous mania data');
    return out;
  }

  // Top tickers
  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([t, c]) => ({ ticker: t, mentions: c, samples: recent[t] || [] }));

  // Compare with previous run for spike detection
  let history = readJsonSafe(HISTORY, { snapshots: [] });
  if (!Array.isArray(history.snapshots)) history = { snapshots: [] };
  const lastSnapshot = history.snapshots[history.snapshots.length - 1] || { counts: {} };
  const spikes = ranked.map(r => {
    const prevC = lastSnapshot.counts[r.ticker] || 0;
    return {
      ...r,
      previous: prevC,
      delta: r.mentions - prevC,
      spike_factor: prevC > 0 ? +(r.mentions / prevC).toFixed(2) : (r.mentions > 2 ? 99 : 1)
    };
  });

  history.snapshots.push({
    timestamp: new Date().toISOString(),
    counts: Object.fromEntries(ranked.map(r => [r.ticker, r.mentions]))
  });
  history.snapshots = history.snapshots.slice(-48); // keep last 48 snapshots (~24h at 30min)
  writeJsonAtomic(HISTORY, history);

  // Mania classification
  const totalMentions = ranked.reduce((a, r) => a + r.mentions, 0);
  let maniaLevel = 'CALM';
  if (totalMentions > 100) maniaLevel = 'EXTREME';
  else if (totalMentions > 60) maniaLevel = 'ELEVATED';
  else if (totalMentions > 30) maniaLevel = 'NORMAL';

  const out = {
    timestamp: new Date().toISOString(),
    posts_scanned: totalPosts,
    total_mentions: totalMentions,
    mania_level: maniaLevel,
    top_tickers: spikes,
    note: 'Mention spike (delta > prev) = retail attention surge = often contrarian signal'
  };

  writeJsonAtomic(OUT, out);
  const top5 = ranked.slice(0, 5).map(r => r.ticker + '=' + r.mentions).join(' ');
  log(`✅ ${totalPosts} posts · ${totalMentions} mentions · ${maniaLevel} · top: ${top5}`);
  return out;
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 30 * 60 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

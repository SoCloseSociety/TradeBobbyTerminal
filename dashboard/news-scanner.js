// ── News & Sentiment Scanner v2 ──
// Bloomberg-style intelligence: geopolitics, AI, energy, shipping, defense, crypto, metals
// Runs via cron every 15min, NO AI calls, purely keyword-based

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEWS_PATH = join(__dirname, 'news_feed.json');
const LOG_PATH = join(__dirname, 'news-scanner.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

// ── RSS FEEDS (Google News search, no API key) ──
const FEEDS = [
  // GEOPOLITICS
  { topic: 'iran', category: 'GEO', url: 'https://news.google.com/rss/search?q=iran+hormuz+IRGC&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'russia', category: 'GEO', url: 'https://news.google.com/rss/search?q=russia+ukraine+sanctions+oil&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'china', category: 'GEO', url: 'https://news.google.com/rss/search?q=china+taiwan+trade+sanctions&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'tariffs', category: 'GEO', url: 'https://news.google.com/rss/search?q=trump+tariffs+china+trade&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'middle_east', category: 'GEO', url: 'https://news.google.com/rss/search?q=israel+lebanon+syria+gaza&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },

  // SHIPPING / MARITIME CHOKEPOINTS
  { topic: 'hormuz', category: 'SHIP', url: 'https://news.google.com/rss/search?q=strait+of+hormuz+tanker+attack&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'suez', category: 'SHIP', url: 'https://news.google.com/rss/search?q=suez+canal+red+sea+houthi&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'panama', category: 'SHIP', url: 'https://news.google.com/rss/search?q=panama+canal+drought+shipping&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'tankers', category: 'SHIP', url: 'https://news.google.com/rss/search?q=oil+tanker+seized+dark+fleet&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },

  // ENERGY
  { topic: 'oil', category: 'ENERGY', url: 'https://news.google.com/rss/search?q=oil+crude+OPEC+sanctions&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'natgas', category: 'ENERGY', url: 'https://news.google.com/rss/search?q=natural+gas+LNG+pipeline+europe&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'uranium', category: 'ENERGY', url: 'https://news.google.com/rss/search?q=uranium+nuclear+reactor+kazatomprom&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'power_grid', category: 'ENERGY', url: 'https://news.google.com/rss/search?q=power+grid+electricity+demand+data+center&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },

  // AI / TECH
  { topic: 'ai_chips', category: 'AI', url: 'https://news.google.com/rss/search?q=nvidia+AI+chip+export+control&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'ai_models', category: 'AI', url: 'https://news.google.com/rss/search?q=OpenAI+Anthropic+Google+AI+model+release&hl=en-US&gl=US&ceid=US:en', priority: 'LOW' },
  { topic: 'ai_compute', category: 'AI', url: 'https://news.google.com/rss/search?q=data+center+AI+investment+billion&hl=en-US&gl=US&ceid=US:en', priority: 'LOW' },

  // METALS / COMMODITIES
  { topic: 'gold', category: 'METAL', url: 'https://news.google.com/rss/search?q=gold+price+central+bank&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'silver', category: 'METAL', url: 'https://news.google.com/rss/search?q=silver+COMEX+squeeze&hl=en-US&gl=US&ceid=US:en', priority: 'HIGH' },
  { topic: 'copper', category: 'METAL', url: 'https://news.google.com/rss/search?q=copper+supply+mining+chile+peru&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'platinum', category: 'METAL', url: 'https://news.google.com/rss/search?q=platinum+palladium+deficit&hl=en-US&gl=US&ceid=US:en', priority: 'LOW' },

  // MACRO
  { topic: 'fed', category: 'MACRO', url: 'https://news.google.com/rss/search?q=federal+reserve+rate+inflation&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'ecb', category: 'MACRO', url: 'https://news.google.com/rss/search?q=ECB+lagarde+euro+rate&hl=en-US&gl=US&ceid=US:en', priority: 'LOW' },
  { topic: 'dollar', category: 'MACRO', url: 'https://news.google.com/rss/search?q=DXY+dollar+strength+yen+intervention&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'bonds', category: 'MACRO', url: 'https://news.google.com/rss/search?q=treasury+yield+bond+auction+10+year&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },

  // CRYPTO
  { topic: 'bitcoin', category: 'CRYPTO', url: 'https://news.google.com/rss/search?q=bitcoin+ETF+institutional+flow&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'eth', category: 'CRYPTO', url: 'https://news.google.com/rss/search?q=ethereum+ETF+staking+upgrade&hl=en-US&gl=US&ceid=US:en', priority: 'LOW' },

  // DEFENSE / MILITARY
  { topic: 'defense', category: 'DEFENSE', url: 'https://news.google.com/rss/search?q=defense+contract+missile+raytheon+lockheed&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' },
  { topic: 'nato', category: 'DEFENSE', url: 'https://news.google.com/rss/search?q=NATO+troops+deployment+europe&hl=en-US&gl=US&ceid=US:en', priority: 'MEDIUM' }
];

// ── SENTIMENT KEYWORDS (weighted) ──
const BULLISH_GOLD = [
  'war', 'conflict', 'escalation', 'sanction', 'tariff', 'crisis',
  'central bank buying', 'safe haven', 'inflation', 'hedge',
  'IRGC', 'hardliner', 'attack', 'strike', 'missile', 'nuclear',
  'dedollarization', 'BRICS', 'gold reserves', 'repatriate'
];

const BEARISH_GOLD = [
  'ceasefire', 'peace', 'deal', 'truce', 'negotiation', 'calm',
  'rate hike', 'hawkish', 'dollar strength', 'risk-on',
  'resolved', 'agreement', 'moderate'
];

const BULLISH_OIL = [
  'hormuz', 'blockade', 'disruption', 'sanction', 'supply shock',
  'OPEC cut', 'shortage', 'pipeline damage', 'strike', 'attack',
  'embargo', 'tension', 'escalation', 'houthi', 'tanker seized',
  'dark fleet', 'refinery fire', 'drone strike'
];

const BEARISH_OIL = [
  'ceasefire', 'deal', 'increase production', 'oversupply',
  'demand slump', 'recession', 'stockpile increase', 'SPR release'
];

const BULLISH_SILVER = [
  'comex', 'squeeze', 'delivery failure', 'industrial demand',
  'solar', 'deficit', 'physical shortage', 'EFP', 'basis'
];

const BULLISH_COPPER = [
  'supply', 'mine strike', 'grid', 'electrification', 'EV',
  'codelco', 'deficit', 'shortage'
];

const BULLISH_URANIUM = [
  'nuclear restart', 'SMR', 'reactor', 'supply deficit',
  'kazatomprom', 'enrichment', 'ban russian uranium'
];

const BULLISH_AI = [
  'compute', 'GPU demand', 'data center', 'AI investment',
  'breakthrough', 'model release', 'partnership', 'funding',
  'billion', 'capex'
];

const BEARISH_AI = [
  'bubble', 'plateau', 'scaling wall', 'layoffs',
  'regulation', 'antitrust', 'chip ban'
];

const RISK_OFF = [
  'recession', 'crash', 'panic', 'selloff', 'volatility',
  'bank failure', 'credit event', 'margin call', 'liquidation'
];

// ── CRITICAL TRIGGERS (auto-alerts) ──
const CRITICAL_TRIGGERS = [
  // EXTREME
  { word: 'hormuz closed', impact: 'EXTREME', assets: ['XAUUSD','USOIL','XAGUSD'] },
  { word: 'strait closed', impact: 'EXTREME', assets: ['XAUUSD','USOIL'] },
  { word: 'missile strike', impact: 'EXTREME', assets: ['XAUUSD','USOIL'] },
  { word: 'war declared', impact: 'EXTREME', assets: ['XAUUSD','USOIL','XAGUSD','NAS100'] },
  { word: 'comex delivery failure', impact: 'EXTREME', assets: ['XAGUSD'] },
  { word: 'nuclear strike', impact: 'EXTREME', assets: ['XAUUSD','USOIL','NAS100'] },
  { word: 'bank failure', impact: 'EXTREME', assets: ['XAUUSD','NAS100','BTCUSD'] },

  // HIGH
  { word: 'IRGC', impact: 'HIGH', assets: ['XAUUSD','USOIL'] },
  { word: 'ship seized', impact: 'HIGH', assets: ['USOIL','XAUUSD'] },
  { word: 'tanker attacked', impact: 'HIGH', assets: ['USOIL'] },
  { word: 'pipeline sabotage', impact: 'HIGH', assets: ['USOIL','NATGAS'] },
  { word: 'refinery fire', impact: 'HIGH', assets: ['USOIL'] },
  { word: 'houthi', impact: 'HIGH', assets: ['USOIL'] },
  { word: 'ceasefire breaks', impact: 'HIGH', assets: ['XAUUSD','USOIL'] },
  { word: 'silver squeeze', impact: 'HIGH', assets: ['XAGUSD'] },
  { word: 'OPEC surprise', impact: 'HIGH', assets: ['USOIL'] },
  { word: 'sanctions', impact: 'HIGH', assets: ['USOIL','XAUUSD'] },
  { word: 'chip ban', impact: 'HIGH', assets: ['NAS100'] },

  // MEDIUM
  { word: 'rate cut', impact: 'MEDIUM', assets: ['XAUUSD','XAGUSD','NAS100','BTCUSD'] },
  { word: 'rate hike', impact: 'MEDIUM', assets: ['XAUUSD','XAGUSD','NAS100','BTCUSD'] },
  { word: 'central bank buying', impact: 'MEDIUM', assets: ['XAUUSD'] },
  { word: 'BRICS', impact: 'MEDIUM', assets: ['XAUUSD'] },
  { word: 'grid stress', impact: 'MEDIUM', assets: ['NATGAS','URANIUM'] },
  { word: 'data center', impact: 'MEDIUM', assets: ['NAS100','URANIUM','NATGAS'] }
];

// ── XML PARSER ──
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = (content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || '';
    const pubDate = (content.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
    const description = (content.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]?.trim() || '';
    const link = (content.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
    const source = (content.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]?.trim() || '';
    if (title) {
      items.push({
        title,
        pubDate,
        description: description.replace(/<[^>]+>/g, '').substring(0, 200),
        link,
        source
      });
    }
  }
  return items;
}

// ── SENTIMENT SCORING ──
function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  let goldScore = 0, oilScore = 0, silverScore = 0, copperScore = 0;
  let uraniumScore = 0, aiScore = 0, riskOffScore = 0;

  BULLISH_GOLD.forEach(kw => { if (lower.includes(kw.toLowerCase())) goldScore += 1; });
  BEARISH_GOLD.forEach(kw => { if (lower.includes(kw.toLowerCase())) goldScore -= 1; });
  BULLISH_OIL.forEach(kw => { if (lower.includes(kw.toLowerCase())) oilScore += 1; });
  BEARISH_OIL.forEach(kw => { if (lower.includes(kw.toLowerCase())) oilScore -= 1; });
  BULLISH_SILVER.forEach(kw => { if (lower.includes(kw.toLowerCase())) silverScore += 1; });
  BULLISH_COPPER.forEach(kw => { if (lower.includes(kw.toLowerCase())) copperScore += 1; });
  BULLISH_URANIUM.forEach(kw => { if (lower.includes(kw.toLowerCase())) uraniumScore += 1; });
  BULLISH_AI.forEach(kw => { if (lower.includes(kw.toLowerCase())) aiScore += 1; });
  BEARISH_AI.forEach(kw => { if (lower.includes(kw.toLowerCase())) aiScore -= 1; });
  RISK_OFF.forEach(kw => { if (lower.includes(kw.toLowerCase())) riskOffScore += 1; });

  const triggers = [];
  CRITICAL_TRIGGERS.forEach(t => {
    if (lower.includes(t.word.toLowerCase())) triggers.push(t);
  });

  return { goldScore, oilScore, silverScore, copperScore, uraniumScore, aiScore, riskOffScore, triggers };
}

// ── FETCH ──
async function fetchFeed(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 TradeBobby/2.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    log(`Fetch error ${url.substring(0, 60)}: ${e.message}`);
    return null;
  }
}

// ── BIAS FROM SCORE ──
function bias(avg, threshold = 0.3) {
  if (avg > threshold) return 'BULLISH';
  if (avg < -threshold) return 'BEARISH';
  return 'NEUTRAL';
}

// ── MAIN ──
async function run() {
  log('═══ NEWS SCAN v2 START ═══');
  const allItems = [];
  const allTriggers = [];
  const categoryStats = {};

  let sums = { gold: 0, oil: 0, silver: 0, copper: 0, uranium: 0, ai: 0, riskOff: 0 };
  let itemCount = 0;

  for (const feed of FEEDS) {
    log(`Fetching [${feed.category}] ${feed.topic}...`);
    const xml = await fetchFeed(feed.url);
    if (!xml) continue;

    const items = parseRSS(xml).slice(0, 8);
    if (!categoryStats[feed.category]) categoryStats[feed.category] = { count: 0, triggers: 0 };

    for (const item of items) {
      const text = item.title + ' ' + item.description;
      const s = analyzeSentiment(text);
      sums.gold += s.goldScore;
      sums.oil += s.oilScore;
      sums.silver += s.silverScore;
      sums.copper += s.copperScore;
      sums.uranium += s.uraniumScore;
      sums.ai += s.aiScore;
      sums.riskOff += s.riskOffScore;
      itemCount++;
      categoryStats[feed.category].count++;

      allItems.push({
        topic: feed.topic,
        category: feed.category,
        priority: feed.priority,
        title: item.title,
        description: item.description,
        pubDate: item.pubDate,
        link: item.link,
        source: item.source,
        scores: {
          gold: s.goldScore, oil: s.oilScore, silver: s.silverScore,
          copper: s.copperScore, uranium: s.uraniumScore, ai: s.aiScore,
          riskOff: s.riskOffScore
        },
        triggers: s.triggers.map(t => t.word)
      });

      if (s.triggers.length > 0) {
        categoryStats[feed.category].triggers += s.triggers.length;
        s.triggers.forEach(t => {
          allTriggers.push({
            trigger: t.word,
            impact: t.impact,
            assets: t.assets,
            title: item.title,
            pubDate: item.pubDate,
            link: item.link,
            category: feed.category
          });
        });
      }
    }
    log(`  ${items.length} items from ${feed.topic}`);
  }

  // ── AGGREGATE ──
  const avg = {};
  for (const k in sums) avg[k] = itemCount > 0 ? sums[k] / itemCount : 0;

  // Sort by priority + recency
  allItems.sort((a, b) => {
    const pV = p => p === 'HIGH' ? 3 : p === 'MEDIUM' ? 2 : 1;
    if (pV(a.priority) !== pV(b.priority)) return pV(b.priority) - pV(a.priority);
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Deduplicate triggers by word
  const uniqueTriggers = [];
  const seenTriggers = new Set();
  for (const t of allTriggers) {
    const key = t.trigger + '|' + t.title.substring(0, 40);
    if (!seenTriggers.has(key)) {
      seenTriggers.add(key);
      uniqueTriggers.push(t);
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
    total_items: allItems.length,
    categories: categoryStats,
    sentiment: {
      gold: { raw: sums.gold, avg: +avg.gold.toFixed(2), bias: bias(avg.gold, 0.3) },
      oil: { raw: sums.oil, avg: +avg.oil.toFixed(2), bias: bias(avg.oil, 0.3) },
      silver: { raw: sums.silver, avg: +avg.silver.toFixed(2), bias: bias(avg.silver, 0.2) },
      copper: { raw: sums.copper, avg: +avg.copper.toFixed(2), bias: bias(avg.copper, 0.2) },
      uranium: { raw: sums.uranium, avg: +avg.uranium.toFixed(2), bias: bias(avg.uranium, 0.15) },
      ai: { raw: sums.ai, avg: +avg.ai.toFixed(2), bias: bias(avg.ai, 0.3) },
      risk_off: { raw: sums.riskOff, avg: +avg.riskOff.toFixed(2), level: sums.riskOff > 5 ? 'HIGH' : sums.riskOff > 2 ? 'ELEVATED' : 'NORMAL' }
    },
    critical_triggers: uniqueTriggers,
    items: allItems.slice(0, 250)
  };

  writeFileSync(NEWS_PATH, JSON.stringify(output, null, 2));
  log('');
  log(`═══ SUMMARY ═══`);
  log(`Total: ${itemCount} items across ${Object.keys(categoryStats).length} categories`);
  log(`Gold: ${output.sentiment.gold.bias} (${avg.gold.toFixed(2)}) | Oil: ${output.sentiment.oil.bias} (${avg.oil.toFixed(2)})`);
  log(`Silver: ${output.sentiment.silver.bias} | Copper: ${output.sentiment.copper.bias} | AI: ${output.sentiment.ai.bias}`);
  log(`Risk-off: ${output.sentiment.risk_off.level} | Triggers: ${uniqueTriggers.length}`);
  uniqueTriggers.slice(0, 5).forEach(t => log(`  [${t.impact}] ${t.trigger} - ${t.title.substring(0, 80)}`));
  log('═══ NEWS SCAN COMPLETE ═══');
}

run().catch(e => log(`ERROR: ${e.message}`));

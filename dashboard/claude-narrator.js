// ── Claude API Narrator ──
// Calls Claude API every 4h with the trade brief, gets a concise narrative.
// Opt-in: requires ANTHROPIC_API_KEY env var.
// Uses prompt caching for cost efficiency.
//
// Install: npm i @anthropic-ai/sdk
// One-shot: ANTHROPIC_API_KEY=sk-ant-... node claude-narrator.js
// Daemon: node claude-narrator.js --daemon

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'claude_narrative.json');
const LOG = join(__dirname, 'claude-narrator.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';  // Cheap + fast for narration

const SYSTEM_PROMPT = `You are TradeBobby's market narrator. You analyze multi-source market data and produce a 3-paragraph briefing in French:

Paragraph 1 — Macro state (Risk Index, VIX, DXY, yields, sector rotation)
Paragraph 2 — Top opportunity with rationale (use the top idea from the brief)
Paragraph 3 — Risks ahead (divergences, COT extremes, upcoming catalysts)

Be concise, direct, actionable. ICT/SMC trader audience.
Use \`code\` blocks for specific levels and prices.`;

async function callClaude(brief) {
  if (!API_KEY) {
    log('⚠ ANTHROPIC_API_KEY not set — skipping');
    return null;
  }

  const userMsg = `Brief snapshot:\n${JSON.stringify({
    timestamp: brief.timestamp,
    regime: brief.regime,
    risk_index: brief.risk_index,
    top_ideas: (brief.ideas || []).slice(0, 3),
    divergences: brief.divergences,
    snapshot: brief.snapshot,
    catalysts: brief.catalysts?.econ?.slice(0, 3)
  }, null, 2)}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    if (!r.ok) {
      log(`❌ Claude API ${r.status}: ${await r.text()}`);
      return null;
    }
    const j = await r.json();
    const narrative = j.content?.[0]?.text || '';
    log(`✅ Claude responded (${narrative.length} chars · cache: ${j.usage?.cache_creation_input_tokens||0} creation, ${j.usage?.cache_read_input_tokens||0} read)`);
    return { narrative, usage: j.usage, model: MODEL };
  } catch (e) {
    log('❌ Claude API error: ' + e.message);
    return null;
  }
}

async function run() {
  log('🤖 Calling Claude narrator...');
  if (!API_KEY) {
    const placeholder = {
      timestamp: new Date().toISOString(),
      narrative: '_Claude narrator inactive — set ANTHROPIC_API_KEY env var to enable AI-generated regime narration._',
      configured: false
    };
    writeFileSync(OUT, JSON.stringify(placeholder, null, 2));
    log('⏸ ANTHROPIC_API_KEY not set — wrote placeholder');
    return;
  }

  const brief = readJSON(join(__dirname, 'trade_brief.json'));
  if (!brief) { log('❌ no trade_brief.json'); return; }

  const result = await callClaude(brief);
  if (!result) return;

  const out = {
    timestamp: new Date().toISOString(),
    brief_timestamp: brief.timestamp,
    narrative: result.narrative,
    model: result.model,
    usage: result.usage,
    configured: true
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  log('✅ narrative saved');
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 4 * 3600 * 1000);
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

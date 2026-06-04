// ── TTS Narrator (macOS `say`) ──
// Speaks the current market regime + top idea every 4 hours during active sessions.
// Uses macOS native `say` command — no API key needed.
//
// One-shot: node tts-narrator.js
// Daemon: node tts-narrator.js --daemon

import { exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger } from './_log-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'tts-narrator.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function say(text, voice = 'Samantha', rate = 180) {
  const safe = text.replace(/['"`$\\]/g, '');
  exec(`say -v "${voice}" -r ${rate} "${safe}"`, (err) => {
    if (err) log('  ⚠ say error: ' + err.message);
  });
}

function buildNarrative() {
  const brief = readJSON(join(__dirname, 'trade_brief.json')) || {};
  const crypto = readJSON(join(__dirname, 'crypto_pulse.json')) || {};
  const macro = readJSON(join(__dirname, 'macro_pulse.json')) || { data: {} };

  const risk = brief.risk_index?.score;
  const label = brief.risk_index?.label;
  const regime = brief.regime?.verdict;
  const vix = macro.data?.vix?.price;
  const fg = crypto.fear_greed?.current;
  const topIdea = brief.ideas?.[0];

  let parts = [];
  if (risk !== undefined) {
    parts.push(`Risk index ${risk}, ${label}.`);
  }
  if (regime) parts.push(`Regime ${regime}.`);
  if (vix !== undefined) {
    const vstate = vix < 15 ? 'complacent' : vix < 20 ? 'normal' : vix < 25 ? 'elevated' : 'stressed';
    parts.push(`VIX ${vix.toFixed(1)} ${vstate}.`);
  }
  if (fg !== undefined) {
    parts.push(`Crypto fear and greed ${fg}.`);
  }
  if (topIdea) {
    parts.push(`Top setup: ${topIdea.grade} ${topIdea.direction} ${topIdea.symbol}, score ${topIdea.synthesis_score}.`);
  }
  return parts.join(' ');
}

function shouldSpeak() {
  // Only speak during active sessions in UTC+7 (Koh Samui)
  const now = new Date();
  const utcH = now.getUTCHours();
  const localH = (utcH + 7) % 24;
  // Speak only during London + NY (14:00-23:00 UTC+7 = 07:00-16:00 UTC)
  return localH >= 14 && localH < 23;
}

function run() {
  if (!shouldSpeak()) {
    log('⏸ outside active session — silent');
    return;
  }
  const txt = buildNarrative();
  if (!txt) { log('⚠ no data to narrate'); return; }
  log('🎙 speaking: ' + txt);
  say(txt);
}

if (process.argv.includes('--daemon')) {
  run();
  // Every 2 hours
  setInterval(run, 2 * 3600 * 1000);
} else {
  // One-shot: speak regardless of session
  const txt = buildNarrative();
  if (txt) { log('🎙 ' + txt); say(txt); }
  else log('⚠ no data');
}

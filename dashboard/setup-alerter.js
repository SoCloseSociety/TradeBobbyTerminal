// ── Setup A+ Alerter ──
// Watches live_setups.json for NEW high-quality (A+/A) setups.
// Triggers macOS native notification + writes to alerts banner JSON for dashboard.
//
// One-shot: node setup-alerter.js
// Daemon: node setup-alerter.js --daemon

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkLogger, writeJsonAtomic } from './_log-helper.js';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETUPS = join(__dirname, 'live_setups.json');
const STATE = join(__dirname, '.alerter_state.json');
const PENDING = join(__dirname, 'pending_alerts.json');
const LOG = join(__dirname, 'setup-alerter.log');
const log = mkLogger(LOG);

function readJSON(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function notifyMac(title, message) {
  // Use osascript on macOS for native notification.
  // Strip shell/AppleScript metacharacters (like tts-narrator.js) — the string is
  // interpolated into a shell command, so quotes/backticks/$ must never survive.
  const t = title.replace(/['"`$\\]/g, '');
  const m = message.replace(/['"`$\\]/g, '');
  exec(`osascript -e 'display notification "${m}" with title "${t}" sound name "Funk"'`,
    (err) => { if (err) log('  ⚠ osascript: ' + err.message); });
}

// Discord webhook (opt-in via env var DISCORD_WEBHOOK_URL)
async function notifyDiscord(alert) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const color = alert.quality === 'A+' ? 0x00E676 : alert.quality === 'A' ? 0x4CAF50 : 0xFFB800;
  const dirEmoji = alert.direction === 'LONG' ? '📈' : '📉';
  const body = {
    username: 'TradeBobby',
    embeds: [{
      title: `${dirEmoji} ${alert.quality || 'A'} ${alert.direction} ${alert.symbol}`,
      color,
      fields: [
        { name: 'Entry', value: String(alert.entry), inline: true },
        { name: 'SL', value: String(alert.sl), inline: true },
        { name: 'TP2', value: String(alert.tp2 || alert.tp1 || '—'), inline: true },
        { name: 'R:R', value: String(alert.rr || '?'), inline: true },
        { name: 'Score', value: String(alert.score || '?'), inline: true },
        { name: 'Reasons', value: (alert.reasons || []).slice(0, 3).join(' · ') || '—' }
      ],
      timestamp: alert.timestamp
    }]
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!r.ok) log(`  ⚠ Discord webhook ${r.status}`);
  } catch (e) {
    log('  ⚠ Discord webhook error: ' + e.message);
  }
}

// Telegram bot (opt-in via env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
async function notifyTelegram(alert) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const dirEmoji = alert.direction === 'LONG' ? '📈' : '📉';
  const text = `${dirEmoji} *${alert.quality || 'A'} ${alert.direction} ${alert.symbol}*\n`
    + `Entry: \`${alert.entry}\`  SL: \`${alert.sl}\`  TP: \`${alert.tp2 || alert.tp1 || '—'}\`\n`
    + `R:R ${alert.rr || '?'}  Score ${alert.score || '?'}\n`
    + `${(alert.reasons || []).slice(0, 3).join(' · ')}`;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) log(`  ⚠ Telegram ${r.status}`);
  } catch (e) {
    log('  ⚠ Telegram error: ' + e.message);
  }
}

function makeId(s) {
  return `${s.symbol}_${s.direction}_${Math.round(s.entry * 1000)}_${s.quality||''}`;
}

function shouldAlert(setup) {
  // Alert on quality A+ or A, or score >= 6
  if (!setup) return false;
  const q = (setup.quality || '').toUpperCase();
  if (q === 'A+' || q === 'A') return true;
  if ((setup.score || 0) >= 6) return true;
  return false;
}

async function run() {
  const live = readJSON(SETUPS);
  const state = readJSON(STATE) || { seen: [], lastRun: null };
  const seen = new Set(state.seen.slice(-200));

  if (!live?.setups) {
    return;
  }

  const newAlerts = [];
  for (const s of live.setups) {
    if (!shouldAlert(s)) continue;
    const id = makeId(s);
    if (seen.has(id)) continue;
    seen.add(id);
    const title = `${s.quality||'A'} ${s.direction} ${s.symbol}`;
    const msg = `Entry ${s.entry} · SL ${s.sl} · TP2 ${s.tp2||s.tp} · R:R ${s.rr||'?'} · Score ${s.score||'?'}`;
    log(`🚨 ALERT: ${title} — ${msg}`);
    notifyMac(title, msg);
    const alert = {
      id,
      timestamp: new Date().toISOString(),
      symbol: s.symbol,
      direction: s.direction,
      quality: s.quality,
      score: s.score,
      entry: s.entry,
      sl: s.sl,
      tp1: s.tp1,
      tp2: s.tp2 || s.tp,
      rr: s.rr,
      reasons: s.reasons,
      message: `${title} · ${msg}`
    };
    newAlerts.push(alert);
    // Fire optional webhooks (no-op if env vars unset)
    notifyDiscord(alert);
    notifyTelegram(alert);
  }

  // Persist state
  state.seen = Array.from(seen);
  state.lastRun = new Date().toISOString();
  writeJsonAtomic(STATE, state);

  // Persist pending alerts (last 12 — dashboard will pick these up and show as banner)
  let pending = readJSON(PENDING) || { alerts: [] };
  pending.alerts = [...newAlerts, ...pending.alerts].slice(0, 12);
  pending.timestamp = new Date().toISOString();
  writeJsonAtomic(PENDING, pending);

  if (newAlerts.length > 0) {
    log(`✅ ${newAlerts.length} new alert(s) fired`);
  }
}

if (process.argv.includes('--daemon')) {
  run().catch(e => log('❌ ' + e.message));
  setInterval(() => run().catch(e => log('❌ ' + e.message)), 60 * 1000);  // check every minute
} else {
  run().catch(e => { log('❌ ' + e.message); process.exit(1); });
}

// ── Economic Calendar (minimalistic, no API keys) ──
// Pulls from RSS feeds + known recurring events (FOMC, NFP, CPI, ECB, BOJ).
// Runs from cron or manually: node econ-calendar.js
// Writes to econ_calendar.json

import { writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'econ_calendar.json');
const LOG = join(__dirname, 'econ-calendar.log');

function log(m) {
  const l = `[${new Date().toISOString()}] ${m}`;
  console.log(l);
  try { appendFileSync(LOG, l + '\n'); } catch {}
}

// ── RECURRING SCHEDULE (high-impact) ──
// Approximate UTC times for reliable events. Dates fill automatically in "this month".
const RECURRING = [
  // Monthly NFP: first Friday ~13:30 UTC
  { name: 'US Non-Farm Payrolls (NFP)', rule: 'firstFriday', time: '13:30', impact: 'HIGH', affects: ['DXY','XAUUSD','NAS100','USDJPY'] },
  // US CPI: typically 2nd Tuesday/Wednesday ~13:30 UTC
  { name: 'US CPI', rule: 'secondWed', time: '13:30', impact: 'HIGH', affects: ['DXY','XAUUSD','NAS100','BTCUSD'] },
  // FOMC minutes: 3rd Wed (some months ~19:00 UTC)
  { name: 'FOMC Minutes', rule: 'thirdWed', time: '19:00', impact: 'HIGH', affects: ['DXY','XAUUSD','NAS100'] },
  // ECB rate decision: typically 6 times/year on Thursdays
  { name: 'ECB Rate Decision (possible)', rule: 'firstThursday', time: '12:15', impact: 'HIGH', affects: ['EURUSD','DXY','DAX','CAC40'] },
  // PMI manufacturing: first business day of month
  { name: 'ISM Manufacturing PMI', rule: 'firstBusinessDay', time: '15:00', impact: 'MEDIUM', affects: ['DXY','SPX500','NAS100'] },
  // Retail sales: ~15th of month
  { name: 'US Retail Sales', rule: 'day15', time: '13:30', impact: 'MEDIUM', affects: ['DXY','SPX500'] },
  // Jobless Claims: every Thursday
  { name: 'Initial Jobless Claims', rule: 'everyThursday', time: '13:30', impact: 'LOW', affects: ['DXY','SPX500'] },
  // EIA Crude Oil inventories: every Wednesday
  { name: 'EIA Crude Oil Inventories', rule: 'everyWednesday', time: '15:30', impact: 'HIGH', affects: ['USOIL','UKOIL'] }
];

function nth(year, month, n, weekday) {
  // weekday: 0=Sun, 5=Fri
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (d.getUTCMonth() === month) {
    if (d.getUTCDay() === weekday) { count++; if (count === n) return new Date(d); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}
function firstBusinessDay(year, month) {
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function resolveDate(rule, year, month) {
  switch(rule) {
    case 'firstFriday': return nth(year, month, 1, 5);
    case 'firstThursday': return nth(year, month, 1, 4);
    case 'secondWed': return nth(year, month, 2, 3);
    case 'thirdWed': return nth(year, month, 3, 3);
    case 'firstBusinessDay': return firstBusinessDay(year, month);
    case 'day15': return new Date(Date.UTC(year, month, 15));
    case 'everyThursday': return null; // handled separately
    case 'everyWednesday': return null; // handled separately
    default: return null;
  }
}

function weeklyEvents(event, from, to) {
  const result = [];
  const wd = event.rule === 'everyThursday' ? 4 : event.rule === 'everyWednesday' ? 3 : -1;
  if (wd < 0) return result;
  const d = new Date(from.getTime());
  while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1);
  while (d < to) {
    const [hh, mm] = event.time.split(':').map(Number);
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm));
    result.push({ name: event.name, datetime: dt.toISOString(), impact: event.impact, affects: event.affects });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return result;
}

function buildCalendar() {
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 3600 * 1000); // 3 days back
  const to = new Date(now.getTime() + 30 * 24 * 3600 * 1000);  // 30 days forward

  const events = [];

  // Resolve recurring one-shots per month
  for (let d = new Date(from); d < to; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    for (const ev of RECURRING) {
      if (['everyThursday','everyWednesday'].includes(ev.rule)) continue;
      const dt = resolveDate(ev.rule, y, m);
      if (!dt) continue;
      const [hh, mm] = ev.time.split(':').map(Number);
      dt.setUTCHours(hh, mm, 0, 0);
      if (dt >= from && dt <= to) {
        events.push({ name: ev.name, datetime: dt.toISOString(), impact: ev.impact, affects: ev.affects });
      }
    }
  }
  // Weekly events
  for (const ev of RECURRING) {
    if (['everyThursday','everyWednesday'].includes(ev.rule)) {
      events.push(...weeklyEvents(ev, from, to));
    }
  }

  // Sort by date, deduplicate
  events.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const seen = new Set();
  const out = events.filter(e => {
    const k = e.name + '|' + e.datetime;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return {
    timestamp: new Date().toISOString(),
    total: out.length,
    events: out
  };
}

function run() {
  const data = buildCalendar();
  writeFileSync(OUT, JSON.stringify(data, null, 2));
  log(`Generated ${data.total} events (next 30d)`);
  const upcoming = data.events.filter(e => new Date(e.datetime) > new Date()).slice(0, 5);
  upcoming.forEach(e => {
    const dt = new Date(e.datetime);
    log(`  [${e.impact}] ${dt.toUTCString().substring(0, 22)} - ${e.name}`);
  });
}

// --daemon: regenerate daily (replaces the old crontab entry that broke when the repo moved).
if (process.argv.includes('--daemon')) {
  run();
  setInterval(run, 24 * 60 * 60 * 1000);
} else {
  run();
}

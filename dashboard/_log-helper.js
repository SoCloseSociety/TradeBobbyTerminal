// Shared log helper with size cap (rotate when > 1MB, keep last 1000 lines).
// Import and use: import { mkLogger } from './_log-helper.js';
//                  const log = mkLogger(LOG_FILE_PATH);
// Also exports writeJsonAtomic (tmp+rename, no torn reads) and readJsonSafe.

import { appendFileSync, existsSync, statSync, readFileSync, writeFileSync, renameSync } from 'fs';

const MAX_BYTES = 1_000_000;      // 1 MB cap per log file
const KEEP_LINES = 1000;          // Lines retained after rotation

export function mkLogger(path) {
  return function log(m) {
    const l = `[${new Date().toISOString()}] ${m}`;
    console.log(l);
    try {
      appendFileSync(path, l + '\n');
      // Rotate if oversize
      if (existsSync(path) && statSync(path).size > MAX_BYTES) {
        const tail = readFileSync(path, 'utf8').split('\n').slice(-KEEP_LINES).join('\n');
        writeFileSync(path, tail);
      }
    } catch {}
  };
}

// Atomic JSON write: write to <path>.tmp then rename over <path>,
// so readers never see a half-written file.
export function writeJsonAtomic(path, data) {
  writeFileSync(path + '.tmp', JSON.stringify(data, null, 2));
  renameSync(path + '.tmp', path);
}

// Safe JSON read: returns fallback if the file is missing or unparseable.
export function readJsonSafe(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return fallback; }
}

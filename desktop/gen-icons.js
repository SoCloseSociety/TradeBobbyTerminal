// Generates the TradeBobby app icons with zero dependencies (Node zlib for valid PNGs).
// Draws a dark rounded tile with a green up-candle + red down-candle. Emits several sizes
// into assets/. iconutil (mac) then turns the PNG set into icon.icns; png2ico-equivalent
// handled by electron-builder for .ico.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
fs.mkdirSync(OUT, { recursive: true });

function px(w, h, draw) {
  const data = Buffer.alloc(w * h * 4, 0); // RGBA, transparent
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  draw(set, w, h);
  return data;
}

function encodePNG(w, h, rgba) {
  // filter byte 0 per scanline
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length, 0);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

function drawIcon(set, w, h) {
  const s = w / 32; // design on a 32-grid, scale up
  const rect = (x0, y0, x1, y1, r, g, b, a) => {
    for (let y = Math.floor(y0 * s); y < Math.ceil(y1 * s); y++)
      for (let x = Math.floor(x0 * s); x < Math.ceil(x1 * s); x++) set(x, y, r, g, b, a);
  };
  // rounded dark tile
  const pad = 1 * s, rad = 6 * s;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < pad || y < pad || x > w - pad || y > h - pad) continue;
    const cx = Math.min(Math.max(x, pad + rad), w - pad - rad);
    const cy = Math.min(Math.max(y, pad + rad), h - pad - rad);
    const d = Math.hypot(x - cx, y - cy);
    if (d <= rad) set(x, y, 14, 18, 24, 255); // #0e1218
  }
  // green up-candle (left)
  rect(9, 8, 12, 24, 40, 220, 120, 255);   // body
  rect(10, 5, 11, 27, 40, 220, 120, 255);  // wick
  // red down-candle (right)
  rect(20, 12, 23, 26, 255, 70, 70, 255);  // body
  rect(21, 9, 22, 29, 255, 70, 70, 255);   // wick
}

const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const sz of sizes) {
  const png = encodePNG(sz, sz, px(sz, sz, drawIcon));
  fs.writeFileSync(path.join(OUT, `icon_${sz}.png`), png);
}
// canonical names used by main.js / builder
fs.copyFileSync(path.join(OUT, 'icon_32.png'), path.join(OUT, 'tray.png'));
fs.copyFileSync(path.join(OUT, 'icon_512.png'), path.join(OUT, 'icon.png'));
console.log('icons written to', OUT);

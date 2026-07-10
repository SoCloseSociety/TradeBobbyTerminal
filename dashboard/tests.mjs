// Integration tests for the TradeBobby dashboard -- run with the server up:
//   node --test tests.mjs        (or: npm test)
// Pure HTTP shape assertions: no imports of scanner modules (they run on import).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3333';
const get = async (p) => {
  const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) });
  assert.equal(r.ok, true, `${p} -> HTTP ${r.status}`);
  return r;
};
const getJson = async (p) => (await get(p)).json();

test('health: 13 sources, summary shape', async () => {
  const h = await getJson('/api/health');
  assert.equal(typeof h.ok, 'boolean');
  assert.equal(Object.keys(h.sources).length, 13);
  for (const [k, v] of Object.entries(h.sources)) {
    assert.equal(typeof v.ok, 'boolean', `source ${k} missing ok`);
  }
  const s = h.summary;
  assert.equal(s.ok + s.stale + s.missing, 13);
});

test('orderflow: 8 pairs, valid regimes, coherent divergences', async () => {
  const o = await getJson('/api/orderflow');
  assert.equal(o.symbols.length, 8);
  const REGIMES = ['BULLISH_FLOW', 'BEARISH_FLOW', 'ACCUMULATION', 'DISTRIBUTION', 'NEUTRAL'];
  for (const x of o.symbols) {
    assert.ok(REGIMES.includes(x.regime), `${x.symbol} bad regime ${x.regime}`);
    assert.ok(Number.isFinite(x.cvd), `${x.symbol} cvd not finite`);
    assert.ok(x.buy_ratio >= 0 && x.buy_ratio <= 1, `${x.symbol} buy_ratio out of range`);
    if (x.divergence === 'BULL_DIV') assert.equal(x.regime, 'ACCUMULATION');
    if (x.divergence === 'BEAR_DIV') assert.equal(x.regime, 'DISTRIBUTION');
  }
  assert.ok(['NET_BULLISH', 'NET_BEARISH', 'MIXED'].includes(o.summary.net_bias));
});

test('orderflow-klines: candles have OHLC + taker buy, sane invariants', async () => {
  const d = await getJson('/api/orderflow-klines?symbol=BTCUSDT&interval=5m&limit=30');
  assert.ok(d.candles.length > 0, 'no candles');
  for (const c of d.candles) {
    for (const f of ['t', 'o', 'h', 'l', 'c', 'v', 'tb']) assert.ok(Number.isFinite(c[f]), `candle missing ${f}`);
    assert.ok(c.h >= c.l, 'high < low');
    assert.ok(c.tb <= c.v + 1e-9, 'taker buy exceeds volume');
  }
});

test('orderflow-depth: asks above mid, bids below, no empty band', async () => {
  const d = await getJson('/api/orderflow-depth?symbol=BTCUSDT');
  assert.ok(d.levels.length >= 16, 'band too small');
  assert.ok(Number.isFinite(d.mid) && d.mid > 0);
  let seenBid = false;
  for (const l of d.levels) {
    if (l.side === 'bid') seenBid = true;
    if (l.side === 'ask') {
      assert.equal(seenBid, false, 'ask after bid: levels out of order');
      assert.ok(l.price > d.mid, 'ask priced below mid');
    } else {
      assert.ok(l.price < d.mid, 'bid priced above mid');
    }
  }
  const withVol = d.levels.filter(l => l.vol > 0).length;
  assert.ok(withVol / d.levels.length > 0.2, 'band mostly empty: sizing regressed');
});

test('orderflow-trades: classified sides, chronological desc', async () => {
  const d = await getJson('/api/orderflow-trades?symbol=BTCUSDT');
  assert.ok(d.trades.length > 0, 'no trades');
  for (const t of d.trades) assert.ok(t.side === 'buy' || t.side === 'sell');
  for (let i = 1; i < d.trades.length; i++) assert.ok(d.trades[i].t <= d.trades[i - 1].t, 'tape not newest-first');
});

test('bad symbol is rejected, not proxied', async () => {
  const d = await getJson('/api/orderflow-depth?symbol=..%2Fetc');
  assert.equal(d.levels.length, 0);
  assert.ok(d.error, 'expected an error field');
});

test('scan: prices are distinct across symbols (stale-quote guard)', async () => {
  const s = await getJson('/api/scan');
  const prices = (s.symbols || []).map(x => x.price).filter(p => p != null);
  if (prices.length >= 6) {
    const distinct = new Set(prices.map(p => p.toFixed(4))).size;
    assert.ok(distinct >= prices.length - 2, `price contamination: only ${distinct}/${prices.length} distinct`);
  }
});

test('orderflow-stream: SSE delivers real-time trade events', async () => {
  const r = await fetch(BASE + '/api/orderflow-stream?symbol=BTCUSDT', { signal: AbortSignal.timeout(20000) });
  assert.equal(r.ok, true, `stream HTTP ${r.status}`);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', gotTrade = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !gotTrade) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (/event: trade\ndata: \{/.test(buf)) {
      const m = buf.match(/event: trade\ndata: (\{[^\n]+\})/);
      if (m) {
        const t = JSON.parse(m[1]);
        assert.ok(Number.isFinite(t.p) && Number.isFinite(t.q), 'trade payload malformed');
        assert.ok(t.side === 'buy' || t.side === 'sell');
        gotTrade = true;
      }
    }
  }
  reader.cancel().catch(() => {});
  assert.ok(gotTrade, 'no trade event within 15s (stream dead?)');
});

test('pages: terminal and /live serve with key markers', async () => {
  const term = await (await get('/')).text();
  assert.ok(term.includes('TRADEBOBBY'), 'terminal brand missing');
  assert.ok(term.includes('/live'), 'terminal missing LIVE link');
  const live = await (await get('/live')).text();
  for (const m of ['canvas id="chart"', 'drawChart', 'alertstrip', 'orderflow-klines']) {
    assert.ok(live.includes(m), `/live missing marker ${m}`);
  }
});

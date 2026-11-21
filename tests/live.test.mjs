/**
 * Tests for docs/assets/live.js — the browser-side transport.
 *
 * These run in Node with a stub WebSocket so the state machine is exercised
 * without a browser: connect, greet, receive pushes, drop, reconnect, give up,
 * and the two ways it must refuse to pretend (static page, dead server).
 *
 * Run: node tests/live.test.mjs
 */

import assert from 'node:assert/strict';
import {
  LiveRelay, RELAY_STATE, relayUrl, detectSwing, applyTickerFrame, transportSummary,
} from '../docs/assets/live.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); }
}

/** Minimal WebSocket stand-in with the four events the code uses. */
class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  #fire(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
  open() { this.readyState = 1; this.#fire('open'); }
  message(data) { this.#fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }); }
  close() { this.readyState = 3; this.#fire('close'); }
  error() { this.#fire('error'); }
  send(text) { this.sent.push(text); }
}

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

await test('relayUrl stays on the page origin and refuses file://', () => {
  assert.equal(relayUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/live');
  assert.equal(relayUrl({ protocol: 'https:', host: 'example.test' }), 'wss://example.test/live');
  assert.equal(relayUrl({ protocol: 'file:', host: '' }), null, 'a static file cannot host a socket');
});

await test('a static page reports "unavailable" and never opens a socket', async () => {
  FakeSocket.instances = [];
  const relay = new LiveRelay({ url: null, WebSocketImpl: FakeSocket });
  const lost = [];
  relay.on('lost', (e) => lost.push(e));
  relay.start();
  assert.equal(relay.state, 'unavailable');
  assert.equal(FakeSocket.instances.length, 0, 'no socket object may be created');
  assert.equal(lost[0].reason, 'unavailable');
});

await test('connects, adopts the hello frame and measures round-trip latency', async () => {
  FakeSocket.instances = [];
  const relay = new LiveRelay({ url: 'ws://x/live', WebSocketImpl: FakeSocket, heartbeatMs: 50 });
  const states = [];
  const hellos = [];
  let rtt = null;
  relay.on('state', (s) => states.push(s.state));
  relay.on('hello', (h) => hellos.push(h));
  relay.on('rtt', (v) => { rtt = v; });

  relay.start();
  assert.equal(relay.state, 'connecting');
  const ws = FakeSocket.instances[0];
  ws.open();
  assert.equal(relay.state, 'open');
  ws.message({ type: 'hello', data: { relay: 'same-origin /live', feed: null } });
  assert.equal(hellos[0].relay, 'same-origin /live');

  // The heartbeat sends the application-level "ping" the server answers.
  await flush(70);
  assert.ok(ws.sent.includes('ping'), 'a heartbeat must be sent');
  ws.message({ type: 'pong', data: { at: Date.now() - 5 } });
  assert.ok(rtt >= 0 && rtt < 1000);
  assert.deepEqual(states.slice(0, 2), ['connecting', 'open']);
  relay.stop();
});

await test('pushes are delivered as typed frames', async () => {
  FakeSocket.instances = [];
  const relay = new LiveRelay({ url: 'ws://x/live', WebSocketImpl: FakeSocket });
  const got = [];
  relay.on('message', (m) => got.push(m));
  relay.start();
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].message({ type: 'alert', data: { ticker: 'T', delta: 0.11 } });
  assert.equal(got[0].type, 'alert');
  assert.equal(got[0].data.ticker, 'T');
  relay.stop();
});

await test('reconnects with backoff after the relay drops, then gives up loudly', async () => {
  FakeSocket.instances = [];
  const relay = new LiveRelay({
    url: 'ws://x/live', WebSocketImpl: FakeSocket, maxAttempts: 2,
    reconnectBaseMs: 1, reconnectMaxMs: 2,
  });
  const states = [];
  const lost = [];
  relay.on('state', (s) => states.push(s.state));
  relay.on('lost', (e) => lost.push(e));

  relay.start();
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].close();
  assert.equal(relay.state, 'reconnecting');

  await flush(20);
  assert.equal(FakeSocket.instances.length, 2, 'a second socket is attempted');
  FakeSocket.instances[1].close();
  // Retry budget is 2, so one more attempt is allowed before giving up.
  await flush(20);
  assert.equal(FakeSocket.instances.length, 3, 'the second (final) attempt is made');
  FakeSocket.instances[2].close();
  await flush(60);
  assert.equal(relay.state, 'unavailable', 'it must stop, not hammer the server');
  assert.equal(lost.at(-1).reason, 'gave-up');
  assert.equal(FakeSocket.instances.length, 3, 'no socket is opened after giving up');
  relay.stop();
});

await test('silentFor reports a stall instead of pretending data is flowing', async () => {
  FakeSocket.instances = [];
  const relay = new LiveRelay({ url: 'ws://x/live', WebSocketImpl: FakeSocket });
  relay.start();
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].message({ type: 'hello', data: {} });
  assert.equal(relay.silentFor(10000), false);
  assert.equal(relay.silentFor(-1), true, 'with no traffic in the last -1ms it is silent');
  relay.stop();
});

await test('detectSwing is inclusive at exactly $0.10 in both directions', () => {
  // 0.42 - 0.32 is 0.09999999999999998 as a float: this must still alert.
  const up = detectSwing({ ticker: 'T', previous: 0.32, current: 0.42 });
  assert.ok(up, 'an exactly-$0.10 rise must alert');
  assert.equal(up.deltaTicks, 1000);
  assert.equal(up.direction, 'up');
  assert.equal(up.delta, 0.1);

  const down = detectSwing({ ticker: 'T', previous: 0.42, current: 0.32 });
  assert.ok(down, 'an exactly-$0.10 fall must alert');
  assert.equal(down.delta, -0.1);
  assert.equal(down.direction, 'down');

  assert.equal(detectSwing({ ticker: 'T', previous: 0.40, current: 0.49 }), null, '$0.09 must not alert');
  assert.equal(detectSwing({ ticker: 'T', previous: null, current: 0.49 }), null);
  assert.equal(detectSwing({ ticker: 'T', previous: 0.4, current: null }), null);
});

await test('applyTickerFrame updates a tracked market and raises its swing', () => {
  const markets = [
    { ticker: 'A-1', last_price_dollars: '0.3000', volume_fp: '10' },
    { ticker: 'B-2', last_price_dollars: '0.6000', volume_fp: '20' },
  ];
  const frame = {
    market_ticker: 'A-1',
    price_dollars: '0.4100',
    yes_bid_dollars: '0.4000',
    yes_ask_dollars: '0.4200',
    volume_fp: '11',
    ts_ms: 1,
  };
  const { markets: next, changed, updated } = applyTickerFrame(markets, frame, 123);
  assert.equal(updated, 1);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].ticker, 'A-1');
  assert.equal(changed[0].delta, 0.11);
  assert.equal(next[0].last_price_dollars, '0.4100');
  assert.equal(next[0]._wsSource, 'socket');
  assert.equal(next[1], markets[1], 'untouched markets are not copied or altered');
});

await test('applyTickerFrame ignores a ticker the page does not track', () => {
  const markets = [{ ticker: 'A-1', last_price_dollars: '0.3000' }];
  const { markets: next, updated, changed } = applyTickerFrame(markets, { market_ticker: 'ZZ-9', price_dollars: '0.9' });
  assert.equal(updated, 0);
  assert.equal(changed.length, 0);
  assert.equal(next.length, 1, 'a socket frame must not create a market we cannot classify');
});

await test('transportSummary says out loud what is carrying the data', () => {
  const s1 = transportSummary({ relay: { state: 'open' }, lastPollAt: Date.now(), feed: null });
  assert.match(s1, /socket: live/);
  assert.match(s1, /kalshi: rest \(no key\)/);
  const s2 = transportSummary({ relay: { state: 'unavailable' }, lastPollAt: null, feed: { configured: true, connected: true, state: 'open' } });
  assert.match(s2, /socket: unavailable/);
  assert.match(s2, /kalshi: signed socket/);
});

await test('every relay state has a human label (no raw enum ever reaches the UI)', () => {
  for (const [key, v] of Object.entries(RELAY_STATE)) {
    assert.ok(v.label && v.label.length > 3, `${key} needs a label`);
    assert.ok(['info', 'live', 'warn', 'bad'].includes(v.tone), `${key} needs a known tone`);
  }
});

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) process.exit(1);

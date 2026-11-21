/**
 * Tests for the same-origin browser relay (`/live`) and the Kalshi feed wiring.
 *
 * The relay is the only WebSocket this project serves to browsers. Its job is to
 * push alerts and (when a key is configured) Kalshi ticker frames to the page that
 * this same server rendered. These tests open a real socket against a real server
 * and assert the documented behaviour, including the refusals.
 *
 * Run: node tests/relay.test.mjs
 */

import assert from 'node:assert/strict';
import { createServer, sameOrigin } from '../server/index.js';
import { connectWebSocket } from '../server/ws.js';
import { Collector } from '../server/collector.js';
import { KalshiWsFeed } from '../server/kalshi-ws.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); }
}

const quiet = { info() {}, warn() {}, error() {}, log() {} };

function offlineCollector(mode = 'snapshot') {
  // A client whose every request fails: the collector stays in snapshot mode and
  // never touches the network, so these tests are hermetic.
  const client = {
    authenticated: false,
    async exchangeStatus() { throw new Error('offline test'); },
    async allMarkets() { throw new Error('offline test'); },
    async seriesList() { throw new Error('offline test'); },
    async orderbook() { throw new Error('offline test'); },
  };
  return new Collector({ client, dataMode: mode, allowDemoFallback: false, logger: quiet, dataDir: '/tmp/trade3-relay-test' });
}

async function withServer(fn) {
  const collector = offlineCollector();
  const server = createServer({ collector, logger: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    // A hung test must fail, not stall the suite forever.
    await Promise.race([
      fn({ port, collector, server }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test timed out after 8s')), 8000)),
    ]);
  } finally {
    // Sockets upgraded out of HTTP are NOT tracked by http.Server#close, so a
    // lingering /live client would make close() wait forever. They are not in
    // closeAllConnections() either (that set only covers HTTP connections), so
    // resolve close() and bound the wait instead of hanging.
    await Promise.race([
      new Promise((r) => server.close(r)),
      new Promise((r) => setTimeout(r, 300)),
    ]);
    server.closeAllConnections?.();
  }
}

await test('same-origin rule allows same host, refuses another site, allows no Origin', () => {
  const allow = sameOrigin('example.test:3000');
  assert.equal(allow('https://example.test:3000'), true);
  assert.equal(allow('https://evil.test'), false);
  assert.equal(allow(undefined), true, 'non-browser clients send no Origin');
  assert.equal(allow('not a url'), false);
});

await test('/live greets a same-origin browser with a truthful hello frame', async () => {
  await withServer(async ({ port }) => {
    const conn = await connectWebSocket(`ws://127.0.0.1:${port}/live`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    const hello = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no hello frame')), 2000);
      conn.once('text', (text) => { clearTimeout(t); resolve(JSON.parse(text)); });
    });
    assert.equal(hello.type, 'hello');
    assert.equal(hello.data.relay, 'same-origin /live');
    // No Kalshi key here, so the relay must say so instead of implying streaming.
    assert.equal(hello.data.feed, null);
    assert.match(hello.data.note, /REST-polled/);
    conn.close(1000, 'done');
    await new Promise((r) => setTimeout(r, 30));
  });
});

await test('/live answers an application-level ping with a pong', async () => {
  await withServer(async ({ port }) => {
    const conn = await connectWebSocket(`ws://127.0.0.1:${port}/live`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise((r) => conn.once('text', r));           // hello
    const pong = new Promise((resolve) => {
      conn.on('text', (text) => { const m = JSON.parse(text); if (m.type === 'pong') resolve(m); });
    });
    conn.send('ping');
    const msg = await pong;
    assert.ok(msg.data.at > 0);
    conn.close(1000, 'done');
    await new Promise((r) => setTimeout(r, 30));
  });
});

await test('/live refuses a cross-site Origin with HTTP 403', async () => {
  await withServer(async ({ port }) => {
    await assert.rejects(
      () => connectWebSocket(`ws://127.0.0.1:${port}/live`, {
        headers: { Origin: 'https://evil.example' },
        timeoutMs: 2000,
      }),
      /403/,
    );
  });
});

await test('an unknown upgrade path is refused, not silently upgraded', async () => {
  await withServer(async ({ port }) => {
    await assert.rejects(
      () => connectWebSocket(`ws://127.0.0.1:${port}/socket`, { timeoutMs: 2000 }),
      /404/,
    );
  });
});

await test('collector events are pushed to /live clients as typed frames', async () => {
  await withServer(async ({ port, collector }) => {
    const conn = await connectWebSocket(`ws://127.0.0.1:${port}/live`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise((r) => conn.once('text', r));           // hello
    const frames = [];
    conn.on('text', (text) => frames.push(JSON.parse(text)));

    collector.emit('alert', { ticker: 'TEST-1', delta: 0.12, direction: 'up' });
    collector.emit('trade', { ticker: 'TEST-1', side: 'yes', count: 1 });

    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(frames.map((f) => f.type).slice(0, 2), ['alert', 'trade']);
    assert.equal(frames[0].data.ticker, 'TEST-1');
    conn.close(1000, 'done');
    await new Promise((r) => setTimeout(r, 30));
  });
});

await test('/api/live reports the relay and feed state honestly', async () => {
  await withServer(async ({ port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/live`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.relay.path, '/live');
    assert.equal(body.relay.protocol, 'RFC 6455');
    assert.equal(body.relay.sameOriginOnly, true);
    assert.equal(body.feed, null, 'no feed configured => null, not a fake connected state');
  });
});

await test('a feed with no key reports unconfigured and never opens a socket', async () => {
  let connectCalls = 0;
  const feed = new KalshiWsFeed({
    url: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    keyId: '',
    privateKey: null,
    connect: async () => { connectCalls++; throw new Error('should never be called'); },
    logger: quiet,
  });
  const started = await feed.start();
  assert.equal(started, false);
  assert.equal(connectCalls, 0, 'no handshake is attempted without credentials');
  const s = feed.status();
  assert.equal(s.state, 'unconfigured');
  assert.equal(s.configured, false);
  assert.equal(s.connected, false);
});

await test('the Kalshi handshake signs GET /trade-api/ws/v2 (documented path only)', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const feed = new KalshiWsFeed({
    url: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    keyId: 'test-key-id',
    privateKey,
    logger: quiet,
  });
  const headers = feed.handshakeHeaders();
  assert.equal(headers['KALSHI-ACCESS-KEY'], 'test-key-id');
  assert.match(headers['KALSHI-ACCESS-TIMESTAMP'], /^\d{13}$/, 'timestamp in milliseconds');
  assert.ok(headers['KALSHI-ACCESS-SIGNATURE'].length > 40);

  // Verify the signature over timestamp + "GET" + "/trade-api/ws/v2" ourselves,
  // so a change to the signed text fails this test rather than the exchange.
  const { verify } = await import('node:crypto');
  const signed = `${headers['KALSHI-ACCESS-TIMESTAMP']}GET/trade-api/ws/v2`;
  const ok = verify(null, Buffer.from(signed, 'utf8'), publicKey, Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64'));
  assert.equal(ok, true, 'signature must validate over the documented pre-sign text');

  const wrong = verify(null, Buffer.from(`${headers['KALSHI-ACCESS-TIMESTAMP']}GET/trade-api/v2`, 'utf8'), publicKey,
    Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64'));
  assert.equal(wrong, false, 'the REST prefix must NOT be what is signed');
});

await test('the feed subscribes only to documented public channels and tracks markets', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('ed25519');
  const sent = [];
  const fakeConn = {
    readyState: 'open',
    send: (t) => { sent.push(JSON.parse(t)); return true; },
    close: () => {},
    on: () => {},
  };
  const feed = new KalshiWsFeed({
    url: 'wss://example.invalid/trade-api/ws/v2',
    keyId: 'k',
    privateKey,
    tickers: () => ['AAA-1', 'BBB-2'],
    connect: async () => fakeConn,
    logger: quiet,
  });
  await feed.start();
  await new Promise((r) => setTimeout(r, 30));
  const subs = sent.filter((m) => m.cmd === 'subscribe');
  assert.deepEqual(subs.map((m) => m.params.channels[0]), ['ticker', 'trade', 'market_lifecycle_v2']);
  assert.deepEqual(subs[0].params.market_tickers, ['AAA-1', 'BBB-2']);
  assert.equal(subs.some((m) => m.params.channels.includes('orderbook_delta')), false,
    'orderbook_delta is private and must never be requested');
  feed.stop();
});

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) process.exit(1);

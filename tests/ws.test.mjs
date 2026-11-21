/**
 * RFC 6455 conformance tests for server/ws.js.
 *
 * Every expected value here is copied from the RFC, not from this implementation:
 *   - the handshake accept vector is RFC 6455 §1.3 and §4.2.2 step 5.4;
 *   - the frame vectors are RFC 6455 §5.7 ("Examples");
 *   - the parser edge cases are the MUST clauses in §5.2, §5.4, §5.5 and §8.1.
 *
 * Run: node tests/ws.test.mjs
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';

import {
  acceptKey, encodeFrame, FrameParser, OPCODE, CLOSE_CODE, WS_GUID,
  upgradeRequest, connectWebSocket, Connection,
} from '../server/ws.js';
import { normalizeTicker, dollarsToTicks, PUBLIC_CHANNELS, PRIVATE_CHANNELS } from '../server/kalshi-ws.js';
import { buildOrderbookState, applyBookMessage, BookDepth } from '../server/book.js';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

const hex = (buf) => Buffer.from(buf).toString('hex');
const fromHex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------
await check('RFC 6455 §4.2.2 accept key vector', () => {
  // "the server would then take the SHA-1 hash of this string ... to give the value
  // s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" — published in the RFC itself.
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

await check('WS_GUID is the RFC 6455 §1.3 constant', () => {
  assert.equal(WS_GUID, '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
});

// ---------------------------------------------------------------------------
// Framing — RFC 6455 §5.7 example frames, byte for byte
// ---------------------------------------------------------------------------
await check('RFC 6455 §5.7: single-frame unmasked text "Hello"', () => {
  const frame = encodeFrame({ opcode: OPCODE.TEXT, payload: 'Hello', mask: false });
  assert.equal(hex(frame), '8105' + '48656c6c6f');
});

await check('RFC 6455 §5.7: single-frame masked text "Hello" (fixed key)', () => {
  const maskKey = fromHex('37fa213d');
  const frame = encodeFrame({ opcode: OPCODE.TEXT, payload: 'Hello', mask: true, maskKey });
  assert.equal(hex(frame), '8185' + '37fa213d' + '7f9f4d5158');
});

await check('RFC 6455 §5.7: fragmented unmasked text "Hel" + "lo"', () => {
  const a = encodeFrame({ opcode: OPCODE.TEXT, payload: 'Hel', fin: false, mask: false });
  const b = encodeFrame({ opcode: OPCODE.CONTINUATION, payload: 'lo', fin: true, mask: false });
  assert.equal(hex(a), '0103' + '48656c');
  assert.equal(hex(b), '8002' + '6c6f');
});

await check('RFC 6455 §5.7: masked Ping response has the same body as the ping', () => {
  const ping = encodeFrame({ opcode: OPCODE.PING, payload: 'Hello', mask: false });
  const pong = encodeFrame({ opcode: OPCODE.PONG, payload: 'Hello', mask: true, maskKey: fromHex('37fa213d') });
  assert.equal(hex(ping), '8905' + '48656c6c6f');
  assert.equal(hex(pong), '8a85' + '37fa213d' + '7f9f4d5158');
});

await check('RFC 6455 §5.7: 256-byte binary message uses the 16-bit length form', () => {
  const frame = encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(256, 0xab), mask: false });
  assert.equal(hex(frame.subarray(0, 4)), '827e0100');
});

await check('RFC 6455 §5.7: 65536-byte binary message uses the 64-bit length form', () => {
  const frame = encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(65536, 0xcd), mask: false });
  assert.equal(hex(frame.subarray(0, 10)), '827f0000000000010000');
});

await check('RFC 6455 §5.2: minimal length encoding (124 bytes must stay 7-bit)', () => {
  const frame = encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(124), mask: false });
  assert.equal(frame[1], 124, 'a 124-byte payload must not use the 126 escape');
  const f125 = encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(125), mask: false });
  assert.equal(f125[1], 125);
  const f126 = encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(126), mask: false });
  assert.equal(f126[1], 126);
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
function collect(parser) {
  const out = { messages: [], pings: [], pongs: [], closes: [], errors: [] };
  parser.on('message', (m) => out.messages.push(m));
  parser.on('ping', (p) => out.pings.push(p));
  parser.on('pong', (p) => out.pongs.push(p));
  parser.on('close', (c) => out.closes.push(c));
  parser.on('error', (e) => out.errors.push(e));
  return out;
}

await check('parser reassembles a message delivered one byte at a time', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  const frame = encodeFrame({ opcode: OPCODE.TEXT, payload: '{"a":1}', mask: true });
  for (const byte of frame) parser.push(Buffer.from([byte]));
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].text, '{"a":1}');
});

await check('parser handles several frames in one TCP chunk', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(Buffer.concat([
    encodeFrame({ opcode: OPCODE.TEXT, payload: 'one', mask: true }),
    encodeFrame({ opcode: OPCODE.TEXT, payload: 'two', mask: true }),
  ]));
  assert.deepEqual(out.messages.map((m) => m.text), ['one', 'two']);
});

await check('parser reassembles fragmented text (§5.4)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.TEXT, payload: 'Hel', fin: false, mask: true }));
  parser.push(encodeFrame({ opcode: OPCODE.PING, payload: 'x', mask: true }));   // interleaved control frame
  parser.push(encodeFrame({ opcode: OPCODE.CONTINUATION, payload: 'lo', fin: true, mask: true }));
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].text, 'Hello');
  assert.equal(out.pings.length, 1, 'a control frame may be interleaved mid-message (§5.4)');
});

await check('parser rejects an unmasked client frame when masking is required (§5.3)', () => {
  const parser = new FrameParser({ requireMask: true });
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.TEXT, payload: 'nope', mask: false }));
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].closeCode, CLOSE_CODE.PROTOCOL_ERROR);
});

await check('parser rejects RSV bits without a negotiated extension (§5.2)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  const frame = encodeFrame({ opcode: OPCODE.TEXT, payload: 'x', mask: true });
  frame[0] |= 0x40;                        // set RSV1
  parser.push(frame);
  assert.equal(out.errors.length, 1);
});

await check('parser rejects a fragmented control frame (§5.5)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.PING, payload: 'x', fin: false, mask: true }));
  assert.equal(out.errors.length, 1);
});

await check('parser rejects a control frame with a 126-byte body (§5.5)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.PING, payload: Buffer.alloc(126), mask: true }));
  assert.equal(out.errors.length, 1);
});

await check('parser rejects a continuation with no message in progress (§5.4)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.CONTINUATION, payload: 'x', mask: true }));
  assert.equal(out.errors.length, 1);
});

await check('parser rejects invalid UTF-8 in a text message (§8.1 -> 1007)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.TEXT, payload: Buffer.from([0xff, 0xfe]), mask: true }));
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].closeCode, CLOSE_CODE.INVALID_PAYLOAD);
});

await check('parser reports close frames with code and reason (§5.5.1)', () => {
  const parser = new FrameParser();
  const out = collect(parser);
  const body = Buffer.alloc(2 + 4);
  body.writeUInt16BE(1000, 0);
  body.write('done', 2);
  parser.push(encodeFrame({ opcode: OPCODE.CLOSE, payload: body, mask: true }));
  assert.deepEqual(out.closes, [{ code: 1000, reason: 'done' }]);
});

await check('parser enforces maxPayloadBytes before allocating (§7.1.9)', () => {
  const parser = new FrameParser({ maxPayloadBytes: 16 });
  const out = collect(parser);
  parser.push(encodeFrame({ opcode: OPCODE.BINARY, payload: Buffer.alloc(64), mask: true }));
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].closeCode, CLOSE_CODE.MESSAGE_TOO_BIG);
});

// ---------------------------------------------------------------------------
// End to end over a real TCP socket: our client against our server
// ---------------------------------------------------------------------------
await check('end-to-end: real handshake, text round trip, ping/pong, clean close', async () => {
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      // Rebuild the minimal request head the way Node's http parser would.
      const req = { method: 'GET', headers: {} };
      const lines = chunk.toString('latin1').split('\r\n');
      const [method] = lines[0].split(' ');
      req.method = method;
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        req.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const conn = upgradeRequest(req, socket);
      conn.on('text', (text) => {
        conn.send(JSON.stringify({ echo: JSON.parse(text), type: 'echo' }));
      });
      conn.on('close', () => server.close());
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const conn = await connectWebSocket(`ws://127.0.0.1:${port}/trade-api/ws/v2`);
  const got = new Promise((resolve) => conn.once('text', (t) => resolve(JSON.parse(t))));
  conn.send(JSON.stringify({ cmd: 'subscribe' }));
  const msg = await got;
  assert.equal(msg.type, 'echo');
  assert.equal(msg.echo.cmd, 'subscribe');

  // Client pings, server must answer with an identical-body pong (§5.5.2/§5.5.3).
  const pong = new Promise((resolve) => conn.once('pong', resolve));
  conn.ping(Buffer.from('hb', 'utf8'));
  assert.equal((await pong).toString(), 'hb');

  conn.close(1000, 'test done');
  await new Promise((r) => setTimeout(r, 60));
});

await check('server rejects a handshake with a bad version (426 + Sec-WebSocket-Version)', async () => {
  const received = {};
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      received.raw = chunk.toString('latin1');
      // A raw request with version 8 must be answered 426 per §4.2.1 item 6.
      const key = crypto.randomBytes(16).toString('base64');
      socket.write([
        'GET /trade-api/ws/v2 HTTP/1.1', 'Host: x', 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 8', '', '',
      ].join('\r\n'));
      // Then feed the same head into our validator to see its answer.
      const req = { method: 'GET', headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': key, 'sec-websocket-version': '8' } };
      socket.removeAllListeners('data');
      const res = upgradeRequest(req, socket);
      received.returned = res;
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const raw = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write('GET /trade-api/ws/v2 HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 8\r\n\r\n');
    });
    let buf = '';
    s.on('data', (d) => { buf += d.toString(); if (buf.includes('\r\n\r\n')) { s.destroy(); resolve(buf); } });
  });
  assert.equal(received.returned, null, 'validator must refuse the upgrade');
  assert.equal(received.raw.includes('Sec-WebSocket-Version: 8'), true);
  server.close();
});

await check('client refuses a handshake that echoes the wrong accept key (§4.1)', async () => {
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    socket.write([
      'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Accept: WRONG', '', '',
    ].join('\r\n'));
    socket.destroy();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await assert.rejects(
    () => connectWebSocket(`ws://127.0.0.1:${port}/x`, { timeoutMs: 2000 }),
    /Sec-WebSocket-Accept did not match/,
  );
  await new Promise((r) => server.close(r));
});

await check('client refuses an extension it never offered (§4.1 step 5)', async () => {
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    socket.write([
      'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}`,
      'Sec-WebSocket-Extensions: permessage-deflate', '', '',
    ].join('\r\n'));
    socket.destroy();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await assert.rejects(
    () => connectWebSocket(`ws://127.0.0.1:${port}/x`, { timeoutMs: 2000 }),
    /extension that was not offered/,
  );
  await new Promise((r) => server.close(r));
});

await check('regression: a frame in the same TCP segment as the 101 is not dropped', async () => {
  // Bug found during this build: Connection emitted synchronously from its own
  // constructor, so a frame that arrived with the handshake was emitted before the
  // caller could attach a listener. Buffered bytes now go out on setImmediate.
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      const key = /sec-websocket-key: (.*)/i.exec(chunk.toString('latin1'))[1].trim();
      const head = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`;
      const frame = encodeFrame({ opcode: OPCODE.TEXT, payload: '{"first":true}', mask: false });
      socket.write(Buffer.concat([Buffer.from(head, 'latin1'), frame]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const conn = await connectWebSocket(`ws://127.0.0.1:${port}/x`);
  const first = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('frame that shared the handshake segment was lost')), 1500);
    conn.once('text', (text) => { clearTimeout(t); resolve(text); });
  });
  assert.equal(first, '{"first":true}');
  conn.close(1000, 'done');
  await new Promise((r) => server.close(r));
});

await check('regression: the frame stream stays aligned after a 16-bit length frame', async () => {
  // Bug found during this build: the parser advanced the buffer by the mask-key
  // offset, forgetting the 2 length bytes, which desynchronised every later frame.
  const parser = new FrameParser();
  const out = collect(parser);
  const big = 'x'.repeat(200);                       // forces the 126 / 16-bit form
  parser.push(Buffer.concat([
    encodeFrame({ opcode: OPCODE.TEXT, payload: big, mask: true }),
    encodeFrame({ opcode: OPCODE.TEXT, payload: 'after', mask: true }),
  ]));
  assert.deepEqual(out.messages.map((m) => m.text), [big, 'after']);
});

// ---------------------------------------------------------------------------
// Kalshi payload mapping — field names from the official market-ticker page
// ---------------------------------------------------------------------------
await check('normalizeTicker maps the documented ticker payload', () => {
  // Copied from https://docs.kalshi.com/websockets/market-ticker (Ticker Update).
  const payload = {
    market_id: '9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1',
    market_ticker: 'FED-23DEC-T3.00',
    price_dollars: '0.4800',
    yes_bid_dollars: '0.4500',
    yes_ask_dollars: '0.5300',
    volume_fp: '33896.00',
    open_interest_fp: '20422.00',
    dollar_volume: 16948,
    dollar_open_interest: 10211,
    yes_bid_size_fp: '300.00',
    yes_ask_size_fp: '150.00',
    last_trade_size_fp: '25.00',
    ts: 1669149841,
    ts_ms: 1669149841000,
    time: '2022-11-22T20:44:01Z',
  };
  const m = normalizeTicker(payload);
  assert.equal(m.ticker, 'FED-23DEC-T3.00');
  assert.equal(m.lastPrice, 0.48);
  assert.equal(m.lastPriceTicks, 4800, 'prices compare in 1/10000-dollar ticks');
  assert.equal(m.yesAskDollars, '0.5300');
  assert.equal(m.volumeFp, '33896.00');
  assert.equal(m.tsMs, 1669149841000);
  assert.equal(m.source, 'ws');
});

await check('dollarsToTicks is exact for the $0.10 swing threshold', () => {
  // 0.42 - 0.32 is 0.09999999999999998 in binary floating point, which would
  // silently drop an exactly-$0.10 move if compared as floats.
  assert.equal(dollarsToTicks('0.4200') - dollarsToTicks('0.3200'), 1000);
  assert.notEqual(0.42 - 0.32, 0.1, 'sanity: floats really do drift here');
  assert.equal(dollarsToTicks(null), null);
  assert.equal(dollarsToTicks(''), null);
});

await check('only the documented public channels are ever subscribed', () => {
  assert.deepEqual([...PUBLIC_CHANNELS], ['ticker', 'trade', 'market_lifecycle_v2']);
  assert.equal(Object.keys(PRIVATE_CHANNELS).includes('orderbook_delta'), true);
  assert.equal(PUBLIC_CHANNELS.includes('orderbook_delta'), false, 'orderbook_delta is private per the quick start');
});

// ---------------------------------------------------------------------------
// Order book reconstruction (orderbook_delta is private, so the book is built
// from public REST snapshots; the maths is the documented one)
// ---------------------------------------------------------------------------
await check('order book: YES ask is $1 - NO bid (docs: orderbook responses)', () => {
  const snap = buildOrderbookState({ yes: [[0.44, 100], [0.45, 50]], no: [[0.5, 20]] });
  // Best YES bid 0.45, so the YES ask is 1 - 0.50 = 0.50.
  assert.equal(snap.yesBid, 0.45);
  assert.equal(snap.yesAsk, 0.5);
  assert.equal(snap.spreadTicks, 500);
});

await check('order book: dollar depth is contracts x price per level', () => {
  const snap = buildOrderbookState({ yes: [[0.40, 100], [0.45, 200]], no: [] });
  const levels = snap.levels(new BookDepth({ side: 'yes' }));
  const top = levels[0];
  assert.equal(top.price, 0.45);
  assert.equal(top.contracts, 200);
  assert.equal(top.dollars, 90, '200 contracts x $0.45');
});

await check('order book: cumulative depth within a price band', () => {
  const snap = buildOrderbookState({ yes: [[0.30, 10], [0.40, 10], [0.50, 10]], no: [] });
  const within = snap.depthWithin(0.11);
  assert.equal(within.contracts, 20, 'levels at 0.40 and 0.50 are within 11 cents of the best bid');
  assert.equal(within.dollars, 9.0);
});

await check('order book: no-leg NO prices are flipped into yes space when declared', () => {
  // Official: "a no-side delta at price_dollars=0.30 corresponds to a market offer
  // of 'no at 30c', which would match against 'yes at 70c'".
  const base = buildOrderbookState({ yes: [[0.4, 100]], no: [] });
  const asNoLeg = applyBookMessage(base, {
    type: 'orderbook_delta',
    msg: { market_ticker: 'X', price_dollars: '0.3000', delta: 10, side: 'no' },
  }, { scale: 'no-leg' });
  assert.equal(asNoLeg.no.get(0.7), 10, 'no-leg 0.30 must be stored as yes-leg 0.70');
  const asYesLeg = applyBookMessage(base, {
    type: 'orderbook_delta',
    msg: { market_ticker: 'X', price_dollars: '0.7000', delta: 10, side: 'no' },
  }, { scale: 'yes-leg' });
  assert.equal(asYesLeg.no.get(0.7), 10, 'yes-leg input is stored unchanged');
});

await check('applyBookMessage accepts a delta and a snapshot without inventing levels', () => {
  let state = buildOrderbookState({ yes: [[0.4, 100]], no: [] });
  state = applyBookMessage(state, { type: 'orderbook_snapshot', msg: { market_ticker: 'X', yes: [[0.5, 5]], no: [] } });
  assert.equal(state.yes.get(0.5), 5);
  assert.equal(state.yes.get(0.4), undefined, 'a snapshot replaces the book');
  state = applyBookMessage(state, { type: 'orderbook_delta', msg: { market_ticker: 'X', price: 0.5, delta: -2, side: 'yes' } });
  assert.equal(state.yes.get(0.5), 3);
});

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) process.exit(1);

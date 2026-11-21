/**
 * Minimal, dependency-free WebSocket (RFC 6455) — client and server halves.
 *
 * Why this file exists: Kalshi's WebSocket API authenticates the *handshake* with
 * signed headers, so a browser page cannot open it without shipping a private key
 * to every visitor. The correct architecture (the one the repo's Suggestions page
 * already recommends) is a server-side relay: the Node collector holds the key,
 * opens the socket, and re-broadcasts to the browser over a same-origin socket.
 * This module is that missing relay transport, written to the standard.
 *
 * Every rule below is taken from the RFC text itself, and the tests in
 * tests/ws.test.mjs use the RFC's own published byte vectors:
 *   - RFC 6455 §1.3 / §4.1 / §4.2  opening handshake, Sec-WebSocket-Accept
 *     https://www.rfc-editor.org/rfc/rfc6455.html#section-4
 *   - RFC 6455 §5.2                base framing protocol (FIN/opcode/mask/length)
 *   - RFC 6455 §5.3 / §5.4 / §5.5  masking, fragmentation, control frames
 *   - RFC 6455 §5.7                example frames used verbatim as test vectors
 *   - RFC 6455 §7.4                close codes (1000, 1002, 1009, ...)
 *
 * Deliberately NOT implemented, because Kalshi does not need them and unverified
 * code is worse than absent code:
 *   - extensions (permessage-deflate etc.). We never offer one, and we reject a
 *     server that selects one we did not offer (RFC 6455 §4.1 step 5).
 *   - non-13 protocol versions (RFC 6455 §11.6 — 13 is the only standard one).
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/** RFC 6455 §1.3: the GUID appended to Sec-WebSocket-Key. */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** RFC 6455 §5.2 opcodes. */
export const OPCODE = Object.freeze({
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
});

/** RFC 6455 §7.4.1 close status codes. */
export const CLOSE_CODE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
});

/**
 * SHA-1(key + GUID), base64. RFC 6455 §4.2.2 step 5.4.
 * The RFC's own example: key "dGhlIHNhbXBsZSBub25jZQ==" -> "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=".
 */
export function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID, 'binary').digest('base64');
}

/**
 * Encode one frame.
 * @param {object} o
 * @param {number} o.opcode      OPCODE.*
 * @param {Buffer|string} [o.payload]
 * @param {boolean} [o.fin]      FIN bit, default true (one-frame message)
 * @param {boolean} [o.mask]     MASK bit — clients MUST mask (§5.3), servers MUST NOT (§5.1)
 * @param {Buffer} [o.maskKey]   4 bytes; random when mask is true and this is absent
 * @returns {Buffer}
 */
export function encodeFrame({ opcode, payload = Buffer.alloc(0), fin = true, mask = false, maskKey } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;

  // §5.2: 7-bit length, with 126 -> 16-bit and 127 -> 64-bit escape values.
  // The minimal number of bytes MUST be used (§5.2), so pick the smallest form.
  let lenBytes;
  let lenMarker;
  if (len < 126) {
    lenMarker = len;
    lenBytes = Buffer.alloc(0);
  } else if (len < 65536) {
    lenMarker = 126;
    lenBytes = Buffer.alloc(2);
    lenBytes.writeUInt16BE(len, 0);
  } else {
    lenMarker = 127;
    lenBytes = Buffer.alloc(8);
    // Node buffers cannot exceed 2^31-1 bytes in practice; writeBigUInt64BE keeps
    // the encoding correct even though only small frames are sent here.
    lenBytes.writeBigUInt64BE(BigInt(len), 0);
  }

  const header = Buffer.from([
    (fin ? 0x80 : 0x00) | (opcode & 0x0f),
    (mask ? 0x80 : 0x00) | lenMarker,
  ]);

  if (!mask) return Buffer.concat([header, lenBytes, body]);

  const key = maskKey ? Buffer.from(maskKey) : crypto.randomBytes(4);
  if (key.length !== 4) throw new Error('mask key must be 4 bytes');
  const masked = Buffer.allocUnsafe(len);
  // §5.3: transformed-octet-i = original-octet-i XOR masking-key-octet-(i MOD 4)
  for (let i = 0; i < len; i++) masked[i] = body[i] ^ key[i & 3];
  return Buffer.concat([header, lenBytes, key, masked]);
}

/**
 * Incremental frame parser. Feed it whatever the socket delivered; it emits whole
 * messages. Handles partial frames, 16/64-bit lengths, fragmentation (§5.4),
 * control frames interleaved mid-message (§5.5), and masks.
 *
 * Emits: 'message' ({ text } | { binary }), 'ping' (Buffer), 'pong' (Buffer),
 *        'close' ({ code, reason }), 'error' (Error)
 */
export class FrameParser extends EventEmitter {
  constructor({ requireMask = false, maxPayloadBytes = 4 * 1024 * 1024 } = {}) {
    super();
    this.requireMask = requireMask;
    this.maxPayloadBytes = maxPayloadBytes;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];      // payloads of a message being reassembled
    this.fragmentOpcode = null;
    this.failed = false;
  }

  #fail(message, code = CLOSE_CODE.PROTOCOL_ERROR) {
    if (this.failed) return;         // only the first protocol error is reported
    this.failed = true;
    const err = new Error(message);
    err.closeCode = code;
    this.emit('error', err);
  }

  /** Push raw bytes from the socket. */
  push(chunk) {
    if (this.failed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    // Loop: one read may contain many frames, or a fraction of one.
    for (;;) {
      if (!this.#readOne()) return;
      if (this.failed) return;
    }
  }

  /** Returns true when a complete frame was consumed, false when more bytes are needed. */
  #readOne() {
    const buf = this.buffer;
    if (buf.length < 2) return false;

    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const rsv1 = (b0 & 0x40) !== 0;
    const rsv2 = (b0 & 0x20) !== 0;
    const rsv3 = (b0 & 0x10) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;

    // §5.2: RSV bits MUST be 0 unless an extension that defines them was negotiated.
    // We never negotiate extensions, so any set RSV bit is a protocol error.
    if (rsv1 || rsv2 || rsv3) return void this.#fail('reserved bits set without a negotiated extension');

    if (this.requireMask && !masked) return void this.#fail('client frame was not masked (RFC 6455 §5.3)');

    let offset = 2;          // bytes of the frame header consumed so far
    if (len === 126) {
      if (buf.length < offset + 2) return false;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return false;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return void this.#fail('payload length out of range');
      len = Number(big);
      offset += 8;
    }
    // Remember where the payload actually starts. `offset` grows further for the
    // masking key, so the frame's total header length must be captured here.
    const payloadStart = offset;

    // §5.5: control frames MUST be <= 125 bytes and MUST NOT be fragmented.
    const isControl = (opcode & 0x8) !== 0;
    if (isControl && (len > 125 || !fin)) return void this.#fail('invalid control frame (too long or fragmented)');

    if (len > this.maxPayloadBytes) {
      return void this.#fail(`payload exceeds ${this.maxPayloadBytes} bytes`, CLOSE_CODE.MESSAGE_TOO_BIG);
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return false;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return false;

    let payload = buf.subarray(offset, offset + len);
    if (masked && len) {
      const copy = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) copy[i] = payload[i] ^ maskKey[i & 3];
      payload = copy;
    } else if (masked) {
      payload = Buffer.alloc(0);
    }

    // Advance past header + payload. Using `payloadStart` (not `offset`, which
    // includes the 4-byte mask key) is what keeps the stream aligned for every
    // frame whose length needs the 16- or 64-bit escape form.
    const consumed = (masked ? payloadStart + 4 : payloadStart) + len;
    this.buffer = buf.subarray(consumed);
    this.#dispatch({ fin, opcode, payload });
    return true;
  }

  #dispatch({ fin, opcode, payload }) {
    if (opcode === OPCODE.PING) return void this.emit('ping', Buffer.from(payload));
    if (opcode === OPCODE.PONG) return void this.emit('pong', Buffer.from(payload));
    if (opcode === OPCODE.CLOSE) {
      let code = CLOSE_CODE.NORMAL;
      let reason = '';
      if (payload.length >= 2) {
        code = payload.readUInt16BE(0);
        reason = payload.subarray(2).toString('utf8');
      } else if (payload.length === 1) {
        return void this.#fail('close frame with a 1-byte body');
      }
      return void this.emit('close', { code, reason });
    }

    if (opcode === OPCODE.CONTINUATION) {
      if (this.fragmentOpcode == null) return void this.#fail('continuation frame with no message in progress');
      this.fragments.push(Buffer.from(payload));
    } else if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) {
      if (this.fragmentOpcode != null) return void this.#fail('new data frame while a fragmented message is open');
      this.fragmentOpcode = opcode;
      this.fragments = [Buffer.from(payload)];
    } else {
      return void this.#fail(`reserved opcode 0x${opcode.toString(16)}`);
    }

    if (!fin) return;                       // wait for the terminating frame

    const whole = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
    const type = this.fragmentOpcode;
    this.fragments = [];
    this.fragmentOpcode = null;

    if (type === OPCODE.TEXT) {
      const text = whole.toString('utf8');
      // A malformed UTF-8 message is close code 1007 (§8.1).
      if (Buffer.byteLength(text, 'utf8') !== whole.length) {
        return void this.#fail('text message was not valid UTF-8', CLOSE_CODE.INVALID_PAYLOAD);
      }
      return void this.emit('message', { text });
    }
    return void this.emit('message', { binary: whole });
  }
}

/** A single WebSocket connection over an already-open TCP/TLS socket. */
export class Connection extends EventEmitter {
  constructor(socket, { mask, maxPayloadBytes, buffered = null } = {}) {
    super();
    this.socket = socket;
    this.mask = Boolean(mask);
    this.readyState = 'open';
    this.closed = false;
    this.parser = new FrameParser({ requireMask: !this.mask, maxPayloadBytes });
    this.lastPongAt = null;

    socket.on('data', (chunk) => {
      try { this.parser.push(chunk); } catch (err) { this.emit('error', err); this.close(CLOSE_CODE.INTERNAL_ERROR); }
    });
    socket.on('close', () => this.#markClosed());
    socket.on('error', (err) => { this.emit('error', err); this.#markClosed(); });

    this.parser.on('message', (msg) => {
      if (msg.text != null) {
        this.lastMessageAt = Date.now();
        this.emit('text', msg.text);
      } else this.emit('binary', msg.binary);
    });
    // §5.5.2: "Upon receipt of a Ping frame, an endpoint MUST send a Pong frame in
    // response"; §5.5.3: the Pong "must have identical Application data".
    this.parser.on('ping', (payload) => this.#write(encodeFrame({ opcode: OPCODE.PONG, payload, mask: this.mask })));
    this.parser.on('pong', (payload) => {
      this.lastPongAt = Date.now();
      this.emit('pong', payload);
    });
    this.parser.on('close', ({ code, reason }) => {
      // §5.5.1: reply with a Close frame, then close the TCP connection.
      if (!this.closed) {
        this.close(code, reason);
      }
      this.#markClosed();
    });
    this.parser.on('error', (err) => {
      this.emit('error', err);
      this.close(err.closeCode || CLOSE_CODE.PROTOCOL_ERROR, err.message);
    });

    // Frames can share the TCP segment with the 101 response. They are pushed on
    // the next tick, not here: the constructor returns to the caller first, so its
    // 'text' listeners exist before the first message is emitted. Emitting
    // synchronously from the constructor would silently drop that first frame.
    if (buffered && buffered.length) {
      const bytes = Buffer.from(buffered);
      setImmediate(() => { if (!this.closed) this.parser.push(bytes); });
    }
  }

  #write(frame) {
    if (this.closed || !this.socket.writable) return false;
    try { this.socket.write(frame); return true; } catch { return false; }
  }

  /** Send a text message. Returns false when the socket is no longer writable. */
  send(text) {
    return this.#write(encodeFrame({ opcode: OPCODE.TEXT, payload: text, mask: this.mask }));
  }

  sendBinary(buf) {
    return this.#write(encodeFrame({ opcode: OPCODE.BINARY, payload: buf, mask: this.mask }));
  }

  ping(payload = Buffer.alloc(0)) {
    return this.#write(encodeFrame({ opcode: OPCODE.PING, payload, mask: this.mask }));
  }

  /** Send a Close frame (once) and end the socket. */
  close(code = CLOSE_CODE.NORMAL, reason = '') {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 'closing';
    const body = Buffer.alloc(2 + Buffer.byteLength(reason, 'utf8'));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2, 'utf8');
    this.#write(encodeFrame({ opcode: OPCODE.CLOSE, payload: body, mask: this.mask }));
    // §5.5.1: "The server MUST close the underlying TCP connection immediately".
    try { this.socket.end(); } catch { /* already gone */ }
    setImmediate(() => this.#markClosed());
  }

  #markClosed() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.closed = true;
    try { this.socket.destroy(); } catch { /* already gone */ }
    this.emit('close');
  }
}

/**
 * Validate an inbound HTTP upgrade request per RFC 6455 §4.2.1 and write the
 * 101 response per §4.2.2. Returns a Connection, or null after writing an error.
 */
export function upgradeRequest(req, socket, { checkOrigin = null, maxPayloadBytes } = {}) {
  const reject = (status, message, extraHeaders = {}) => {
    const body = `${message}\n`;
    const head = [`HTTP/1.1 ${status} ${statusText(status)}`, 'Connection: close', 'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`, ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`), '', body];
    try { socket.write(head.join('\r\n')); } catch { /* peer gone */ }
    try { socket.destroy(); } catch { /* peer gone */ }
    return null;
  };

  const header = (name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(',') : v;
  };

  if (req.method !== 'GET') return reject(400, 'WebSocket handshake must be a GET');
  // §4.2.1 items 3 and 4: Upgrade: websocket and Connection: Upgrade (case-insensitive).
  if (String(header('upgrade') || '').toLowerCase() !== 'websocket') return reject(400, 'Upgrade header must be websocket');
  if (!String(header('connection') || '').toLowerCase().split(',').map((s) => s.trim()).includes('upgrade')) {
    return reject(400, 'Connection header must include Upgrade');
  }
  // §4.2.1 item 6: version must be 13; otherwise 426 with the versions we speak.
  if (String(header('sec-websocket-version') || '') !== '13') {
    return reject(426, 'Unsupported WebSocket version', { 'Sec-WebSocket-Version': '13' });
  }
  const key = header('sec-websocket-key');
  // §4.2.1 item 5: a base64 value that decodes to 16 bytes.
  if (!key || Buffer.from(String(key), 'base64').length !== 16) {
    return reject(400, 'Sec-WebSocket-Key must be a base64 value decoding to 16 bytes');
  }
  // §4.1 step 5: we offer no extensions, so a client offering one is fine — we
  // simply decline it by omitting Sec-WebSocket-Extensions from the response.
  // §4.2.2 step 4 ("origin"): the server MAY use Origin to decide whether to accept,
  // and "If the server does not wish to accept this connection, it MUST return an
  // appropriate HTTP error code (e.g., 403 Forbidden)".
  const origin = header('origin');
  if (checkOrigin && !checkOrigin(origin)) {
    return reject(403, 'Origin not allowed');
  }

  const lines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    // Explicitly decline extension negotiation (RFC 6455 §9.1): absent = none in use.
    '',
    '',
  ];
  try { socket.write(lines.join('\r\n')); } catch { try { socket.destroy(); } catch { /* gone */ } return null; }
  socket.setNoDelay?.(true);
  return new Connection(socket, { mask: false, maxPayloadBytes });
}

function statusText(status) {
  return { 400: 'Bad Request', 403: 'Forbidden', 426: 'Upgrade Required' }[status] || 'Error';
}

/**
 * Open an outbound WebSocket connection (client side, masked frames).
 *
 * @param {string} url wss://host/path
 * @param {object} o
 * @param {object} [o.headers]   extra handshake headers (Kalshi signs here)
 * @param {number} [o.timeoutMs] handshake timeout
 * @returns {Promise<Connection>}
 */
export function connectWebSocket(url, { headers = {}, timeoutMs = 15000, maxPayloadBytes } = {}) {
  const target = new URL(url);
  const secure = target.protocol === 'wss:';
  const host = target.hostname;
  const port = target.port ? Number(target.port) : secure ? 443 : 80;
  const pathWithQuery = `${target.pathname || '/'}${target.search || ''}`;
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const socket = secure
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });

    const timer = setTimeout(() => {
      fail(new Error(`WebSocket handshake timed out after ${timeoutMs}ms`));
      try { socket.destroy(); } catch { /* gone */ }
    }, timeoutMs);
    timer.unref?.();

    socket.setNoDelay?.(true);

    socket.once(secure ? 'secureConnect' : 'connect', () => {
      const lines = [
        `GET ${pathWithQuery} HTTP/1.1`,
        `Host: ${host}${port === (secure ? 443 : 80) ? '' : `:${port}`}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        '',
        '',
      ];
      socket.write(lines.join('\r\n'));
    });

    let handshakeBuffer = Buffer.alloc(0);
    let handshakeDone = false;
    const onData = (chunk) => {
      if (handshakeDone) return;   // Connection owns the socket's data events from then on
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const end = handshakeBuffer.indexOf('\r\n\r\n');
      if (end === -1) return;

      clearTimeout(timer);
      const head = handshakeBuffer.subarray(0, end).toString('latin1');
      const leftover = handshakeBuffer.subarray(end + 4);
      const [statusLine, ...headerLines] = head.split('\r\n');
      const m = /^HTTP\/1\.1 (\d{3})/.exec(statusLine);
      const status = m ? Number(m[1]) : 0;
      const hdrs = {};
      for (const line of headerLines) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }

      if (status !== 101) {
        fail(new Error(`WebSocket handshake failed: HTTP ${status || '??'} ${hdrUpgradeHint(status, hdrs)}`));
        try { socket.destroy(); } catch { /* gone */ }
        return;
      }
      // §4.1: verify the accept value, the upgrade headers and that no extension
      // or subprotocol we did not request was selected.
      if (hdrs['sec-websocket-accept'] !== acceptKey(key)) {
        fail(new Error('WebSocket handshake failed: Sec-WebSocket-Accept did not match'));
        try { socket.destroy(); } catch { /* gone */ }
        return;
      }
      if (String(hdrs.upgrade || '').toLowerCase() !== 'websocket') {
        fail(new Error('WebSocket handshake failed: Upgrade header missing from the response'));
        try { socket.destroy(); } catch { /* gone */ }
        return;
      }
      if (hdrs['sec-websocket-extensions']) {
        fail(new Error('WebSocket handshake failed: server selected an extension that was not offered'));
        try { socket.destroy(); } catch { /* gone */ }
        return;
      }
      if (hdrs['sec-websocket-protocol']) {
        fail(new Error('WebSocket handshake failed: server selected a subprotocol that was not offered'));
        try { socket.destroy(); } catch { /* gone */ }
        return;
      }

      // Mark the handshake finished *before* detaching, or a frame that arrived in
      // the same TCP segment as the 101 would be dropped by the guard above.
      handshakeDone = true;
      settled = true;
      socket.off('data', onData);
      // Anything after the CRLFCRLF is already WebSocket frame data.
      resolve(new Connection(socket, { mask: true, maxPayloadBytes, buffered: leftover }));
    };

    socket.on('data', onData);
    socket.once('error', (err) => {
      clearTimeout(timer);
      fail(err instanceof Error ? err : new Error(String(err)));
    });
    socket.once('close', () => {
      clearTimeout(timer);
      fail(new Error('WebSocket connection closed during the handshake'));
    });
  });
}

function hdrUpgradeHint(status, hdrs) {
  if (status === 401 || status === 403) {
    return `(Kalshi rejects a handshake whose signed headers are missing or wrong; sent headers were accepted only if the key, timestamp and signature all match)`;
  }
  if (status === 429) {
    return '(Kalshi returns 429 both for the concurrent-connection limit and for opening connections too quickly — '
      + 'reconnect with exponential backoff; https://docs.kalshi.com/getting_started/quick_start_websockets)';
  }
  const server = hdrs['sec-websocket-version'];
  return server ? `(server supports version ${server})` : '';
}

// server/ is Node-only (the browser loads docs/assets/*.js, never this file), so
// these are ordinary top-level imports of the built-in net/tls modules.
import net from 'node:net';
import tls from 'node:tls';

function netConnect(opts) { return net.connect(opts); }
function tlsConnect(opts) { return tls.connect(opts); }

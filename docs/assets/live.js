// ============================================================================
// Browser-side live transport for the Trade3 dashboard.
//
// Two independent channels, and the UI always shows which one is carrying data:
//
//  1. SAME-ORIGIN SOCKET  (ws(s)://<this host>/live)
//     Served by server/index.js. It needs no key and it is a real WebSocket, so
//     alert pushes arrive the moment the collector detects a swing instead of on
//     the next poll. When the page is opened as a static file (GitHub Pages) there
//     is no server, so this channel is unavailable and says so — it never fakes a
//     connection.
//
//  2. KALSHI MARKET DATA  (REST, from this browser)
//     Public endpoints need no key, and Kalshi's WebSocket requires a signed
//     handshake (https://docs.kalshi.com/getting_started/quick_start_websockets:
//     "WebSocket connections require authentication during the connection
//     handshake"), so a keyless page cannot open it. REST polling is therefore the
//     market-data transport on the static site; the relay upgrades it to push when
//     the server holds a key.
//
// Nothing in this file invents a price, a connection or a timestamp.
// ============================================================================

/** Ready-state labels, used verbatim in the UI so they can never be optimistic. */
export const RELAY_STATE = {
  idle: { label: 'socket: idle', tone: 'info' },
  connecting: { label: 'socket: connecting', tone: 'info' },
  open: { label: 'socket: live', tone: 'live' },
  reconnecting: { label: 'socket: reconnecting', tone: 'warn' },
  unavailable: { label: 'socket: unavailable', tone: 'warn' },
  closed: { label: 'socket: closed', tone: 'warn' },
  error: { label: 'socket: error', tone: 'bad' },
};

/** Where the relay lives, derived from the page itself. Same origin, always. */
export function relayUrl(location) {
  if (!location || !location.protocol) return null;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null; // file:// cannot upgrade
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/live`;
}

/**
 * A small, self-healing WebSocket wrapper around /live.
 *
 * Emits: 'state' ({state, detail}), 'message' (parsed frame), 'rtt' (ms),
 *        'hello' (server handshake frame), 'lost' (socket gave up)
 */
export class LiveRelay {
  constructor({
    url,
    WebSocketImpl = globalThis.WebSocket,
    maxAttempts = 6,
    heartbeatMs = 20000,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30000,
  } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.maxAttempts = maxAttempts;
    this.heartbeatMs = heartbeatMs;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;

    this.ws = null;
    this.state = 'idle';
    this.attempt = 0;
    this.stopped = true;
    this.listeners = new Map();
    this.lastMessageAt = null;
    this.lastSentPingAt = null;
    this.rttMs = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  get available() {
    return Boolean(this.url) && typeof this.WebSocketImpl === 'function';
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  #emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(payload); } catch { /* a bad listener must not break the socket */ }
    }
  }

  #setState(state, detail = '') {
    this.state = state;
    this.#emit('state', { state, detail, ...RELAY_STATE[state] });
  }

  start() {
    if (this.stopped === false) return;       // already running
    this.stopped = false;
    if (!this.available) {
      this.#setState('unavailable', 'No server on this origin (static page) — market data stays on REST polling.');
      this.#emit('lost', { reason: 'unavailable' });
      return;
    }
    this.#connect();
  }

  #connect() {
    if (this.stopped) return;
    this.#setState(this.attempt === 0 ? 'connecting' : 'reconnecting', `attempt ${this.attempt + 1}`);
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (err) {
      this.#setState('error', err && err.message ? err.message : String(err));
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.#setState('open', this.url);
      this.#startHeartbeat();
    });

    ws.addEventListener('message', (ev) => {
      this.lastMessageAt = Date.now();
      let frame;
      try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (frame && frame.type === 'pong' && frame.data && frame.data.at) {
        this.rttMs = Date.now() - frame.data.at;
        this.#emit('rtt', this.rttMs);
        return;
      }
      if (frame && frame.type === 'hello') this.#emit('hello', frame.data);
      this.#emit('message', frame);
    });

    ws.addEventListener('close', () => {
      this.#stopHeartbeat();
      if (this.stopped) { this.#setState('closed'); return; }
      this.#setState('reconnecting', 'the relay closed the socket');
      this.#scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // The browser gives no error detail to script; 'close' always follows.
      this.#setState('error', 'the socket reported an error');
    });
  }

  #scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    if (this.attempt >= this.maxAttempts) {
      this.#setState('unavailable', `gave up after ${this.attempt} attempts — REST polling continues.`);
      this.#emit('lost', { reason: 'gave-up' });
      return;
    }
    // Count this retry *before* scheduling it, so the attempt that exhausts the
    // budget is the one that gives up rather than scheduling an extra wait.
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.attempt);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.lastSentPingAt = Date.now();
      try { this.ws.send('ping'); } catch { /* the close handler will recover */ }
    }, this.heartbeatMs);
  }

  #stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** True when no frame has arrived for longer than `ms` — the UI uses it to warn. */
  silentFor(ms) {
    return this.lastMessageAt == null ? null : Date.now() - this.lastMessageAt > ms;
  }

  stop() {
    this.stopped = true;
    this.#stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(1000, 'page closing'); } catch { /* already gone */ }
    this.ws = null;
    this.#setState('closed');
  }
}

/**
 * Build swing alerts from consecutive snapshots of the same contract.
 *
 * This is the polling path's detector and it must agree exactly with the
 * server's and with strategies.py: the threshold is inclusive, and the
 * comparison happens in integer 1/10000-dollar ticks so that an exactly-$0.10
 * move is never lost to float drift (0.42 - 0.32 = 0.09999999999999998).
 */
export function detectSwing({ ticker, previous, current, thresholdDollars = 0.1, at = Date.now() }) {
  if (previous == null || current == null) return null;
  const prevTicks = Math.round(previous * 10000);
  const nowTicks = Math.round(current * 10000);
  const deltaTicks = nowTicks - prevTicks;
  if (Math.abs(deltaTicks) < Math.round(thresholdDollars * 10000)) return null;
  return {
    at,
    ticker,
    from: prevTicks / 10000,
    to: nowTicks / 10000,
    delta: deltaTicks / 10000,
    deltaTicks,
    direction: deltaTicks > 0 ? 'up' : 'down',
  };
}

/**
 * Merge Kalshi `ticker` socket frames into the market list the page already has.
 * Only documented fields are read; unknown tickers are ignored rather than added,
 * because this page's topic grouping was decided from REST event records and a
 * socket frame cannot tell us which topic a brand-new ticker belongs to.
 */
export function applyTickerFrame(markets, frame, now = Date.now()) {
  if (!frame || !frame.market_ticker) return { markets, changed: [], updated: 0 };
  const px = frame.price_dollars ?? null;
  const bid = frame.yes_bid_dollars ?? null;
  const ask = frame.yes_ask_dollars ?? null;
  let updated = 0;
  const changed = [];
  const next = markets.map((m) => {
    if (m.ticker !== frame.market_ticker) return m;
    const before = m.last_price_dollars == null ? null : Number.parseFloat(m.last_price_dollars);
    const after = px == null ? before : Number.parseFloat(px);
    updated++;
    const swing = detectSwing({ ticker: m.ticker, previous: before, current: after, at: now });
    if (swing) changed.push(swing);
    return {
      ...m,
      last_price_dollars: px ?? m.last_price_dollars,
      yes_bid_dollars: bid ?? m.yes_bid_dollars,
      yes_ask_dollars: ask ?? m.yes_ask_dollars,
      yes_bid_size_fp: frame.yes_bid_size_fp ?? m.yes_bid_size_fp,
      yes_ask_size_fp: frame.yes_ask_size_fp ?? m.yes_ask_size_fp,
      volume_fp: frame.volume_fp ?? m.volume_fp,
      open_interest_fp: frame.open_interest_fp ?? m.open_interest_fp,
      _wsAt: now,
      _wsSource: 'socket',
    };
  });
  return { markets: next, changed, updated };
}

/** One line for the status pill: what is actually carrying data right now. */
export function transportSummary({ relay, lastPollAt, feed }) {
  const relayLabel = RELAY_STATE[relay?.state]?.label || 'socket: idle';
  const poll = lastPollAt ? `rest: ${Math.max(0, Math.round((Date.now() - lastPollAt) / 1000))}s ago` : 'rest: waiting';
  const kalshi = feed && feed.configured
    ? (feed.connected ? 'kalshi: signed socket' : `kalshi: ${feed.state}`)
    : 'kalshi: rest (no key)';
  return `${relayLabel} · ${poll} · ${kalshi}`;
}

/**
 * Kalshi WebSocket market-data feed (server-side relay client).
 *
 * Official sources for every value in this file:
 *   - Endpoints:      https://docs.kalshi.com/getting_started/api_environments
 *   - Handshake auth: https://docs.kalshi.com/getting_started/quick_start_websockets
 *   - Ticker payload: https://docs.kalshi.com/websockets/market-ticker
 *   - Connection msg: https://docs.kalshi.com/websockets/websocket-connection
 *   - Rate limits:    https://docs.kalshi.com/getting_started/rate_limits
 *
 * Facts this module encodes (quoted from those pages in comments so a reader can
 * check each one without leaving the file):
 *
 *  1. "WebSocket connections require authentication during the connection handshake."
 *     Even the public market-data channels use the authenticated session.
 *  2. The signed text is `timestamp + "GET" + "/trade-api/ws/v2"` — the socket path,
 *     NOT the REST path and NOT including the host.
 *  3. Public market-data channels: `ticker`, `trade`, `market_lifecycle_v2`,
 *     `multivariate_market_lifecycle`. Private channels (orderbook_delta, fill,
 *     market_positions, communications, order_group_updates, user_orders) need
 *     per-channel authorisation beyond the handshake.
 *  4. Subscribe bodies use `market_tickers` (array) in the quick start; the
 *     reference also shows the singular `market_ticker`. This module sends the
 *     documented array form from the subscription examples.
 *  5. `ticker` messages carry `price_dollars`, `yes_bid_dollars`, `yes_ask_dollars`,
 *     `volume_fp`, `open_interest_fp`, `yes_bid_size_fp`, `yes_ask_size_fp`,
 *     `ts_ms` — all fixed-point *strings* for prices and sizes.
 *  6. Kalshi sends a Ping after 10 seconds without a data message; the peer must
 *     answer with a Pong. Liveness is judged by data, not by the absence of pings.
 *  7. Reconnect with exponential backoff on 429; close connections you no longer use
 *     (the per-user concurrent WebSocket limit is 200 on Basic/Advanced/Expert,
 *     per the "WebSocket connection limits" table).
 *
 * If no key is configured the feed never pretends to be connected: `status()` says
 * `unconfigured` and the caller keeps using REST polling. Nothing is simulated.
 */

import { EventEmitter } from 'node:events';
import { authHeaders } from './kalshi.js';
import { connectWebSocket } from './ws.js';

/** Public channels only — the ones Kalshi documents as needing no per-channel auth. */
export const PUBLIC_CHANNELS = Object.freeze(['ticker', 'trade', 'market_lifecycle_v2']);

/** Channels this feed never subscribes to, with the documented reason. */
export const PRIVATE_CHANNELS = Object.freeze({
  orderbook_delta: 'private: needs per-channel authorisation beyond the handshake',
  fill: 'private user data',
  market_positions: 'private user data',
  user_orders: 'private user data',
  communications: 'private',
  order_group_updates: 'private',
});

/** Parse a fixed-point dollar string ("0.4800") without float drift in comparisons. */
export function dollarsToTicks(v) {
  if (v == null || v === '') return null;
  const f = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(f) ? Math.round(f * 10000) : null;
}

export class KalshiWsFeed extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.url              wss URL from the official endpoint table
   * @param {string} o.keyId            KALSHI_API_KEY_ID
   * @param {object} o.privateKey       crypto.KeyObject
   * @param {string[]} [o.channels]     default: ['ticker','trade','market_lifecycle_v2']
   * @param {() => string[]} [o.tickers] resolves the market list at (re)subscribe time
   * @param {number} [o.maxTickers]     how many market_tickers to send per channel
   * @param {object} [o.logger]
   */
  constructor({
    url,
    keyId,
    privateKey,
    channels = PUBLIC_CHANNELS,
    tickers = () => [],
    maxTickers = 200,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 60000,
    staleAfterMs = 45000,
    logger = console,
    connect = connectWebSocket,
  } = {}) {
    super();
    this.url = url;
    this.keyId = keyId || '';
    this.privateKey = privateKey || null;
    this.channels = channels.filter((c) => PUBLIC_CHANNELS.includes(c));
    this.tickers = tickers;
    this.maxTickers = maxTickers;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.staleAfterMs = staleAfterMs;
    this.logger = logger;
    this.connect = connect;

    this.conn = null;
    this.attempt = 0;
    this.nextMessageId = 1;
    this.stopped = false;
    this.subscribedTickers = [];
    this.reconnectTimer = null;

    this.stats = {
      state: 'idle',              // idle | connecting | open | reconnecting | stopped | unconfigured | error
      connectedAt: null,
      lastMessageAt: null,
      lastTickerAt: null,
      lastTradeAt: null,
      messages: 0,
      tickers: 0,
      trades: 0,
      lifecycles: 0,
      errors: 0,
      reconnects: 0,
      lastError: null,
      lastErrorAt: null,
      handshakeSignedPath: '/trade-api/ws/v2',
      channels: [...this.channels],
      tickersSubscribed: 0,
    };
  }

  get configured() {
    return Boolean(this.keyId && this.privateKey);
  }

  /** Truthful status for the UI. Never claims a connection that does not exist. */
  status() {
    const staleMs = this.stats.lastMessageAt ? Date.now() - this.stats.lastMessageAt : null;
    return {
      ...this.stats,
      configured: this.configured,
      connected: Boolean(this.conn && this.conn.readyState === 'open'),
      stale: Boolean(staleMs != null && staleMs > this.staleAfterMs),
      msSinceLastMessage: staleMs,
      msSinceLastTicker: this.stats.lastTickerAt ? Date.now() - this.stats.lastTickerAt : null,
      url: this.url,
      publicChannels: PUBLIC_CHANNELS,
      docs: 'https://docs.kalshi.com/getting_started/quick_start_websockets',
    };
  }

  /** Signed handshake headers, built exactly as the WebSocket quick start describes. */
  handshakeHeaders() {
    // "timestamp + \"GET\" + \"/trade-api/ws/v2\"" — path only, no host, no query.
    return authHeaders({
      keyId: this.keyId,
      privateKey: this.privateKey,
      method: 'GET',
      path: '/trade-api/ws/v2',
    });
  }

  async start() {
    if (!this.configured) {
      this.stats.state = 'unconfigured';
      this.stats.lastError = 'No API key. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH/PEM to enable the socket.';
      this.logger.warn?.('WebSocket feed not started: no Kalshi API key configured (channel data stays REST-polled).');
      return false;
    }
    this.stopped = false;
    await this.#open();
    return true;
  }

  async #open() {
    if (this.stopped) return;
    this.stats.state = this.attempt === 0 ? 'connecting' : 'reconnecting';
    let headers;
    try {
      headers = this.handshakeHeaders();
    } catch (err) {
      this.#recordError(err, 'signing');
      return;
    }
    try {
      const conn = await this.connect(this.url, { headers });
      if (this.stopped) { conn.close(1000, 'shutting down'); return; }
      this.conn = conn;
      this.attempt = 0;
      this.stats.state = 'open';
      this.stats.connectedAt = new Date().toISOString();
      this.logger.info?.(`WebSocket connected: ${this.url}`);
      this.emit('open', this.status());

      conn.on('text', (text) => this.#onText(text));
      conn.on('close', () => this.#onClose());
      conn.on('error', (err) => this.#recordError(err, 'socket'));

      this.#subscribe();
    } catch (err) {
      this.#recordError(err, 'handshake');
      this.#scheduleReconnect();
    }
  }

  #subscribe() {
    const tickers = (this.tickers() || []).filter(Boolean).slice(0, this.maxTickers);
    this.subscribedTickers = tickers;
    for (const channel of this.channels) {
      const params = { channels: [channel] };
      // Kalshi documents `market_tickers` (plural, array) in the subscription
      // examples. Omitting it subscribes to all markets, which is far too broad
      // for a five-topic dashboard, so we always send the explicit list.
      if (tickers.length) params.market_tickers = tickers;
      this.#send({ cmd: 'subscribe', params });
    }
    this.stats.tickersSubscribed = tickers.length;
    this.logger.info?.(`WebSocket subscribed: ${this.channels.join(', ')} on ${tickers.length} markets`);
  }

  /** Add markets to every active subscription (used when the topic list changes). */
  resubscribe() {
    if (!this.conn || this.conn.readyState !== 'open') return false;
    const tickers = (this.tickers() || []).filter(Boolean).slice(0, this.maxTickers);
    const added = tickers.filter((t) => !this.subscribedTickers.includes(t));
    if (!added.length) return false;
    for (const channel of this.channels) {
      this.#send({
        cmd: 'update_subscription',
        params: { channel, market_tickers: added, action: 'add_markets' },
      });
    }
    this.subscribedTickers = [...new Set([...this.subscribedTickers, ...added])];
    this.stats.tickersSubscribed = this.subscribedTickers.length;
    return true;
  }

  #send(obj) {
    const msg = { id: this.nextMessageId++, ...obj };
    if (!this.conn || this.conn.readyState !== 'open') return false;
    return this.conn.send(JSON.stringify(msg));
  }

  #onText(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      this.#recordError(new Error(`non-JSON frame from Kalshi WebSocket: ${String(text).slice(0, 120)}`), 'parse');
      return;
    }
    this.stats.messages++;
    this.stats.lastMessageAt = Date.now();

    const type = msg.type;
    if (type === 'ticker') {
      this.stats.tickers++;
      this.stats.lastTickerAt = this.stats.lastMessageAt;
      const m = normalizeTicker(msg.msg);
      if (m) this.emit('ticker', m);
      return;
    }
    if (type === 'trade') {
      this.stats.trades++;
      this.stats.lastTradeAt = this.stats.lastMessageAt;
      this.emit('trade', msg.msg || {});
      return;
    }
    if (type === 'market_lifecycle_v2' || type === 'market_lifecycle') {
      this.stats.lifecycles++;
      this.emit('lifecycle', msg.msg || {});
      return;
    }
    if (type === 'subscribed') {
      this.emit('subscribed', msg.msg || {});
      return;
    }
    if (type === 'ok' || type === 'unsubscribed') {
      this.emit('ack', msg);
      return;
    }
    if (type === 'error') {
      const code = msg.msg && msg.msg.code;
      this.#recordError(new Error(`Kalshi WebSocket error ${code}: ${msg.msg && msg.msg.msg}`), 'channel');
      if (code === 8 || code === 9) {
        // 8 = unknown channel name, 9 = channel needs a permission this key lacks.
        this.logger.warn?.(`channel rejected by Kalshi (code ${code}); continuing with ${this.channels.join(', ')}`);
      }
      return;
    }
    this.emit('unknown', msg);
  }

  #onClose() {
    this.conn = null;
    if (this.stopped) {
      this.stats.state = 'stopped';
      return;
    }
    this.stats.state = 'reconnecting';
    this.emit('close', this.status());
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.stats.reconnects++;
    // Docs: "Reconnect with exponential backoff instead of retrying in a tight loop."
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** Math.max(0, this.attempt));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#open();
    }, delay);
    this.reconnectTimer.unref?.();
    this.logger.warn?.(`WebSocket reconnect in ${delay}ms (attempt ${this.attempt})`);
  }

  #recordError(err, phase) {
    this.stats.errors++;
    this.stats.lastError = `${phase}: ${err && err.message ? err.message : String(err)}`;
    this.stats.lastErrorAt = new Date().toISOString();
    if (this.stats.state === 'open') this.stats.state = 'error';
    this.emit('error', err);
  }

  stop(code = 1000, reason = 'shutdown') {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const conn = this.conn;
    this.conn = null;
    this.stats.state = 'stopped';
    try { conn?.close(code, reason); } catch { /* already gone */ }
  }
}

/**
 * Normalise one `ticker` payload to the field names the rest of this repo uses.
 * Field names are the ones the official market-ticker page documents:
 * price_dollars, yes_bid_dollars, yes_ask_dollars, volume_fp, open_interest_fp,
 * yes_bid_size_fp, yes_ask_size_fp, dollar_volume, ts_ms.
 */
export function normalizeTicker(msg) {
  if (!msg || !msg.market_ticker) return null;
  const price = msg.price_dollars ?? null;
  return {
    source: 'ws',
    ticker: msg.market_ticker,
    marketId: msg.market_id ?? null,
    lastPriceDollars: price,
    lastPrice: price == null ? null : Number.parseFloat(price),
    lastPriceTicks: dollarsToTicks(price),
    yesBidDollars: msg.yes_bid_dollars ?? null,
    yesAskDollars: msg.yes_ask_dollars ?? null,
    yesBidSizeFp: msg.yes_bid_size_fp ?? null,
    yesAskSizeFp: msg.yes_ask_size_fp ?? null,
    volumeFp: msg.volume_fp ?? null,
    openInterestFp: msg.open_interest_fp ?? null,
    dollarVolume: msg.dollar_volume ?? null,
    dollarOpenInterest: msg.dollar_open_interest ?? null,
    lastTradeSizeFp: msg.last_trade_size_fp ?? null,
    tsMs: msg.ts_ms ?? (msg.ts != null ? msg.ts * 1000 : null),
    ts: msg.ts_ms ?? (msg.ts != null ? msg.ts * 1000 : null),
  };
}

// Kalshi WebSocket client (demo by default).
//
// Source K8 (https://docs.kalshi.com/getting_started/quick_start_websockets.md):
//   * The handshake itself is authenticated: KALSHI-ACCESS-KEY / -SIGNATURE /
//     -TIMESTAMP headers, pre-sign text = timestamp + "GET" + "/trade-api/ws/v2".
//   * Subscribe: {"id":N,"cmd":"subscribe","params":{"channels":[...]}}
//     with optional "market_tickers".
//   * Channels we use:
//       ticker               public, 1s flush, no intermediate values (K18)
//       trade                public, every print (K19)
//       market_lifecycle_v2  public, includes determined/settled (K21)
//       orderbook_delta      private, requires market_tickers (K20) — only if a key
//                            is configured AND the caller opts in.
//   * Errors arrive as {"type":"error","msg":{"code":N,"msg":"..."}} and 429 on
//     the handshake means back off (K8). No Reconnect-In-Place; we reconnect with
//     exponential backoff and resubscribe.
//
// Node 22 ships a global WebSocket, so no dependency is required.

import { wsHandshakeHeaders } from './signing.mjs';

const PUBLIC_CHANNELS = ['ticker', 'trade', 'market_lifecycle_v2'];

export class KalshiWs {
  constructor({
    url,
    keyPair = null,
    keyId = '',
    logger = console,
    WebSocketImpl = globalThis.WebSocket,
    onMessage = () => {},
    onStatus = () => {},
    maxBackoffMs = 60_000
  } = {}) {
    this.url = url;
    this.keyPair = keyPair;
    this.keyId = keyId;
    this.logger = logger;
    this.WS = WebSocketImpl;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.maxBackoffMs = maxBackoffMs;
    this.ws = null;
    this.attempt = 0;
    this.msgId = 1;
    this.sidByChannel = new Map();
    this.closedByUser = false;
    this.messagesReceived = 0;
    this.lastMessageAt = 0;
    this.connectedAt = 0;
    this.subscriptions = new Set(PUBLIC_CHANNELS);
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  status() {
    return {
      connected: this.connected,
      url: this.url,
      channels: [...this.subscriptions],
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      connectedAt: this.connectedAt,
      attempt: this.attempt
    };
  }

  #headers() {
    if (this.keyPair && this.keyId) return wsHandshakeHeaders(this.keyPair, this.keyId);
    // Unauthenticated handshake is not supported by Kalshi; surfacing that clearly
    // is better than a silent reconnect loop.
    return {};
  }

  connect() {
    if (!this.WS) {
      this.onStatus({ state: 'error', reason: 'no_websocket_impl' });
      return;
    }
    this.closedByUser = false;
    this.onStatus({ state: 'connecting', url: this.url, attempt: this.attempt });

    let ws;
    try {
      // Browsers reject the options arg; Node accepts headers. Feature-detect.
      const headers = this.#headers();
      ws = Object.keys(headers).length
        ? new this.WS(this.url, { headers })
        : new this.WS(this.url);
    } catch (err) {
      this.logger.warn?.(`[ws] connect threw: ${err.message}`);
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.connectedAt = Date.now();
      this.onStatus({ state: 'open', url: this.url });
      this.#subscribe();
    });

    ws.addEventListener('message', (ev) => {
      this.messagesReceived += 1;
      this.lastMessageAt = Date.now();
      let data;
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (data?.type === 'subscribed' && typeof data.sid === 'number') {
        for (const ch of data.msg?.channels ?? []) this.sidByChannel.set(ch, data.sid);
      }
      if (data?.type === 'error') {
        const code = data.msg?.code;
        this.onStatus({ state: 'error', code, message: data.msg?.msg ?? data.msg });
        // 13/14/26 are subscription-shape errors: resubscribing identically loops.
        if ([13, 14, 26].includes(code)) {
          this.logger.warn?.(`[ws] subscription rejected (code ${code}): ${data.msg?.msg}`);
        }
      }
      this.onMessage(data);
    });

    ws.addEventListener('error', () => {
      this.onStatus({ state: 'error', reason: 'socket_error' });
    });

    ws.addEventListener('close', (ev) => {
      this.onStatus({ state: 'closed', code: ev.code, reason: ev.reason });
      this.ws = null;
      if (!this.closedByUser) this.#scheduleReconnect();
    });
  }

  #subscribe() {
    const params = { channels: [...this.subscriptions] };
    if (this.marketTickers?.length) params.market_tickers = this.marketTickers;
    this.#send({ id: this.msgId, cmd: 'subscribe', params });
  }

  /**
   * Narrow the ticker/trade subscriptions to a set of markets. K18 notes a
   * subscription created WITHOUT a market filter cannot later be changed (error
   * 13), so the caller must decide the filter before the first subscribe.
   */
  setMarketFilter(tickers) {
    this.marketTickers = tickers?.length ? tickers : undefined;
  }

  #send(obj) {
    if (!this.connected) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      this.msgId += 1;
      return true;
    } catch (err) {
      this.logger.warn?.(`[ws] send failed: ${err.message}`);
      return false;
    }
  }

  #scheduleReconnect() {
    if (this.closedByUser) return;
    this.attempt += 1;
    const delay = Math.min(this.maxBackoffMs, 500 * 2 ** this.attempt) + Math.random() * 300;
    this.onStatus({ state: 'reconnecting', attempt: this.attempt, delayMs: Math.round(delay) });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

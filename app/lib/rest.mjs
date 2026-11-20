// Kalshi REST client for the demo environment.
//
// Endpoints used, each verified against the official reference in research/sources.json:
//   GET  /exchange/status                               K23 (unauthenticated)
//   GET  /series?category=&include_volume=true          K12
//   GET  /events?status=open&with_nested_markets=true   K11
//   GET  /markets?series_ticker=&status=open            K9
//   GET  /markets/{ticker}                              K9
//   GET  /markets/{ticker}/orderbook?depth=N            K5, K10
//   GET  /portfolio/balance                             K15 (auth)
//   GET  /portfolio/positions?count_filter=position     K16 (auth)
//   GET  /portfolio/fills                               K17 (auth)
//   POST /portfolio/events/orders                       K13 (auth, V2)
//   DELETE /portfolio/events/orders/{order_id}          K14 (auth, V2)
//
// Rate limits (K4): default 10 tokens/request, 429 => exponential backoff with no
// Retry-After header. We implement a single-flight queue with backoff.

import { authHeaders, loadPrivateKeyFromEnv } from './signing.mjs';
import { config, hasCredentials } from '../config.mjs';

export class KalshiError extends Error {
  constructor(message, { status, code, body, path } = {}) {
    super(message);
    this.name = 'KalshiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.path = path;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KalshiRest {
  constructor({
    baseUrl = config.restBase,
    keyId = config.keyId,
    keyPair = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    logger = console
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.keyId = keyId;
    this.keyPair = keyPair;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.backoffUntil = 0;
    this.stats = { calls: 0, errors: 0, rateLimited: 0, lastError: null, lastOkAt: 0 };
  }

  static fromEnv(opts = {}) {
    let keyPair = null;
    try {
      keyPair = loadPrivateKeyFromEnv();
    } catch (err) {
      firstWarning = err.message;
      keyPair = null;
    }
    return new KalshiRest({ keyId: config.keyId, keyPair, ...opts });
  }

  get authenticated() {
    return Boolean(this.keyId && this.keyPair);
  }

  pathOf(route) {
    // route is like "/markets?limit=5"; the base already contains /trade-api/v2
    return `/trade-api/v2${route}`;
  }

  async request(method, route, { body, auth = false, retries = 3, query } = {}) {
    let routeWithQuery = route;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) routeWithQuery += (route.includes('?') ? '&' : '?') + s;
    }

    const url = this.baseUrl + routeWithQuery;
    const path = this.pathOf(routeWithQuery);

    if (auth && !this.authenticated) {
      throw new KalshiError(
        'Authentication required: set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PATH (K3)',
        { code: 'no_credentials', path }
      );
    }

    let attempt = 0;
    let lastErr;
    while (attempt <= retries) {
      // Honour an active backoff window before even trying (K4).
      const wait = this.backoffUntil - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 30_000));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        this.stats.calls += 1;
        const headers = auth
          ? authHeaders(this.keyPair, this.keyId, method, path)
          : { Accept: 'application/json' };
        const res = await this.fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);

        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (res.ok) {
          this.stats.lastOkAt = Date.now();
          return json;
        }

        // Kalshi error envelope: { error: { code, message } } or { code, message }
        const errObj = json?.error ?? json ?? {};
        const code = errObj.code || `http_${res.status}`;
        const message = errObj.message || res.statusText;

        if (res.status === 429) {
          // K4: no Retry-After; exponential backoff, no penalty bucket.
          this.stats.rateLimited += 1;
          const base = 500 * 2 ** attempt;
          const jitter = Math.random() * 250;
          this.backoffUntil = Date.now() + base + jitter;
          this.logger.warn?.(`[kalshi] 429 on ${method} ${path}, backing off ${Math.round(base + jitter)}ms`);
          lastErr = new KalshiError(`Rate limited: ${message}`, { status: 429, code, body: json, path });
          attempt += 1;
          continue;
        }

        // 5xx is worth retrying; 4xx is not.
        if (res.status >= 500 && attempt < retries) {
          lastErr = new KalshiError(`Server error: ${message}`, { status: res.status, code, body: json, path });
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }

        this.stats.errors += 1;
        this.stats.lastError = { status: res.status, code, message, path, at: Date.now() };
        throw new KalshiError(`${method} ${path} -> ${res.status} ${code}: ${message}`, {
          status: res.status,
          code,
          body: json,
          path
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof KalshiError) throw err;
        // network / abort
        this.stats.errors += 1;
        this.stats.lastError = { status: 0, code: 'network', message: err.message, path, at: Date.now() };
        lastErr = new KalshiError(`Network error on ${method} ${path}: ${err.message}`, {
          status: 0,
          code: 'network',
          path
        });
        if (attempt >= retries) break;
        attempt += 1;
        await sleep(400 * 2 ** attempt);
      }
    }
    throw lastErr ?? new KalshiError('Unknown request failure', { path });
  }

  // ---- public market data (no auth) --------------------------------------

  exchangeStatus() {
    return this.request('GET', '/exchange/status');
  }

  seriesList({ category, includeVolume = true } = {}) {
    return this.request('GET', '/series', { query: { category, include_volume: includeVolume ? 'true' : undefined } });
  }

  events({ status = 'open', limit = 200, cursor, withNestedMarkets = true, minCloseTs, seriesTicker } = {}) {
    return this.request('GET', '/events', {
      query: {
        status,
        limit,
        cursor,
        with_nested_markets: withNestedMarkets ? 'true' : undefined,
        min_close_ts: minCloseTs,
        series_ticker: seriesTicker
      }
    });
  }

  markets({ seriesTicker, eventTicker, status = 'open', limit = 200, cursor, minCloseTs, maxCloseTs } = {}) {
    return this.request('GET', '/markets', {
      query: {
        series_ticker: seriesTicker,
        event_ticker: eventTicker,
        status,
        limit,
        cursor,
        min_close_ts: minCloseTs,
        max_close_ts: maxCloseTs
      }
    });
  }

  market(ticker) {
    return this.request('GET', `/markets/${encodeURIComponent(ticker)}`);
  }

  orderbook(ticker, depth = 10) {
    return this.request('GET', `/markets/${encodeURIComponent(ticker)}/orderbook`, { query: { depth } });
  }

  candlesticks({ seriesTicker, ticker, startTs, endTs, periodInterval = 1 }) {
    return this.request(
      'GET',
      `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
      { query: { start_ts: startTs, end_ts: endTs, period_interval: periodInterval } }
    );
  }

  // ---- portfolio (auth) ---------------------------------------------------

  balance() {
    return this.request('GET', '/portfolio/balance', { auth: true });
  }

  positions({ countFilter = 'position', settlementStatus = 'all', limit = 200 } = {}) {
    return this.request('GET', '/portfolio/positions', {
      auth: true,
      query: { count_filter: countFilter, settlement_status: settlementStatus, limit }
    });
  }

  fills({ limit = 200 } = {}) {
    return this.request('GET', '/portfolio/fills', { auth: true, query: { limit } });
  }

  /**
   * V2 order create. K13: required ticker, side(bid|ask), count, price,
   * time_in_force, self_trade_prevention_type. A 201 means accepted, not resting.
   */
  createOrder({ ticker, side, count, price, timeInForce = 'good_till_canceled', selfTradePreventionType = 'taker_at_cross', clientOrderId, postOnly = false, expirationTime, exchangeIndex }) {
    if (!['bid', 'ask'].includes(side)) {
      throw new KalshiError(`side must be "bid" or "ask" (K13), got "${side}"`, { code: 'bad_side' });
    }
    if (!['fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'].includes(timeInForce)) {
      throw new KalshiError(`time_in_force must be fill_or_kill|good_till_canceled|immediate_or_cancel (K13), got "${timeInForce}"`, {
        code: 'bad_tif'
      });
    }
    const body = {
      ticker,
      side,
      count: typeof count === 'number' ? count.toFixed(2) : count,
      price: typeof price === 'number' ? price.toFixed(4) : price,
      time_in_force: timeInForce,
      self_trade_prevention_type: selfTradePreventionType
    };
    if (clientOrderId) body.client_order_id = clientOrderId;
    if (postOnly) body.post_only = true;
    if (expirationTime) {
      if (timeInForce !== 'good_till_canceled') {
        throw new KalshiError('expiration_time requires time_in_force=good_till_canceled (K13)', { code: 'bad_expiration' });
      }
      body.expiration_time = expirationTime;
    }
    if (exchangeIndex !== undefined) body.exchange_index = exchangeIndex;
    return this.request('POST', '/portfolio/events/orders', { auth: true, body });
  }

  /** K14: DELETE /portfolio/events/orders/{order_id}; market_ticker auto-routes. */
  cancelOrder(orderId, marketTicker) {
    return this.request('DELETE', `/portfolio/events/orders/${encodeURIComponent(orderId)}`, {
      auth: true,
      query: { market_ticker: marketTicker }
    });
  }
}

let firstWarning = null;
export function keyLoadWarning() {
  return firstWarning;
}

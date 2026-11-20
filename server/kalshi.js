/**
 * Kalshi Trade API client.
 *
 * Every path, header name and signing rule in this file is taken from the official
 * Kalshi documentation (verified 2026-11-20):
 *   - https://docs.kalshi.com/getting_started/api_environments
 *   - https://docs.kalshi.com/getting_started/api_keys
 *   - https://docs.kalshi.com/api-reference/orders/create-order-v2
 *   - https://docs.kalshi.com/getting_started/rate_limits
 *
 * Rules implemented verbatim from those pages:
 *   - Pre-sign text is `timestamp + method + path`, where path is the full request
 *     path from the API root and query parameters are stripped.
 *   - Ed25519 keys sign the message directly; RSA keys use RSA-PSS / SHA-256 with
 *     salt length equal to the digest length.
 *   - Headers are KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE, KALSHI-ACCESS-TIMESTAMP
 *     (milliseconds).
 *   - Demo credentials are not shared with production.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export const ENVIRONMENTS = Object.freeze({
  demo: {
    rest: 'https://external-api.demo.kalshi.co/trade-api/v2',
    restAlt: 'https://demo-api.kalshi.co/trade-api/v2',
    ws: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    wsAlt: 'wss://demo-api.kalshi.co/trade-api/ws/v2',
    docs: 'https://docs.kalshi.com/getting_started/demo_env',
  },
  production: {
    rest: 'https://external-api.kalshi.com/trade-api/v2',
    restAlt: 'https://api.elections.kalshi.com/trade-api/v2',
    ws: 'wss://external-api-ws.kalshi.com/trade-api/ws/v2',
    wsAlt: 'wss://api.elections.kalshi.com/trade-api/ws/v2',
    docs: 'https://docs.kalshi.com/getting_started/api_environments',
  },
});

/** Load a PEM private key from an env var (inline PEM) or a file path. */
export function loadPrivateKey({ pem, path }) {
  let material = pem;
  if (!material && path) material = fs.readFileSync(path, 'utf8');
  if (!material) return null;
  return crypto.createPrivateKey(material);
}

/** Ed25519 signs the message directly; everything else is treated as RSA-PSS/SHA-256. */
export function signText(privateKey, text) {
  const message = Buffer.from(text, 'utf8');
  if (privateKey.asymmetricKeyType === 'ed25519') {
    return crypto.sign(null, message, privateKey).toString('base64');
  }
  return crypto
    .sign('sha256', message, {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString('base64');
}

/** Build the three auth headers for one request. Exported for unit tests. */
export function authHeaders({ keyId, privateKey, method, path, timestampMs }) {
  const ts = String(timestampMs ?? Date.now());
  const pathOnly = path.split('?')[0];
  const signature = signText(privateKey, ts + method.toUpperCase() + pathOnly);
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': ts,
  };
}

export class KalshiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'KalshiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Thin REST client. Unauthenticated market data works without credentials; private
 * endpoints require both keyId and privateKey.
 */
export class KalshiClient {
  constructor({
    env = 'demo',
    keyId = process.env.KALSHI_API_KEY_ID || '',
    privateKey = loadPrivateKey({
      pem: process.env.KALSHI_PRIVATE_KEY_PEM,
      path: process.env.KALSHI_PRIVATE_KEY_PATH,
    }),
    timeoutMs = 20000,
    fetchImpl = globalThis.fetch,
    onLog = () => {},
  } = {}) {
    if (!ENVIRONMENTS[env]) throw new Error(`Unknown Kalshi environment: ${env}`);
    this.env = env;
    this.base = ENVIRONMENTS[env].rest;
    this.wsUrl = ENVIRONMENTS[env].ws;
    this.keyId = keyId;
    this.privateKey = privateKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.onLog = onLog;
    // Rate-limit headers the docs describe (X-RateLimit-*), kept for the UI.
    this.lastRateLimit = null;
  }

  get authenticated() {
    return Boolean(this.keyId && this.privateKey);
  }

  /** Full URL for a v2 path such as `/markets`. */
  url(path, query) {
    const u = new URL(this.base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  async request(method, path, { query, body, auth = false } = {}) {
    const url = this.url(path, query);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (auth) {
      if (!this.authenticated) {
        throw new KalshiError('This endpoint requires an API key (KALSHI_API_KEY_ID + private key).', {
          status: 0,
          code: 'missing_credentials',
        });
      }
      // Sign the path from the API root, without query parameters.
      const signPath = new URL(url).pathname;
      Object.assign(headers, authHeaders({
        keyId: this.keyId,
        privateKey: this.privateKey,
        method,
        path: signPath,
      }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new KalshiError(
        `Network error calling ${method} ${path}: ${err.message}. ` +
          'Kalshi hosts may be unreachable from this network (check egress/DNS/TLS).',
        { code: 'network_error' },
      );
    }
    clearTimeout(timer);

    this.lastRateLimit = {
      limit: res.headers.get('x-ratelimit-limit'),
      remaining: res.headers.get('x-ratelimit-remaining'),
      reset: res.headers.get('x-ratelimit-reset'),
      cost: res.headers.get('x-ratelimit-cost'),
      readAt: new Date().toISOString(),
    };

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const code = json?.error?.code || json?.code || `http_${res.status}`;
      const message = json?.error?.message || json?.message || res.statusText;
      this.onLog('warn', `Kalshi ${method} ${path} -> ${res.status} ${code}: ${message}`);
      throw new KalshiError(`${res.status} ${code}: ${message}`, {
        status: res.status,
        code,
        body: json ?? text,
      });
    }
    return json;
  }

  // ---- Public market data ---------------------------------------------------

  exchangeStatus() {
    return this.request('GET', '/exchange/status');
  }

  /** GET /markets — status is one of unopened|open|closed|settled. */
  async markets({ status, seriesTicker, eventTicker, tickers, limit = 1000, cursor, minCloseTs, maxCloseTs, minSettledTs } = {}) {
    const data = await this.request('GET', '/markets', {
      query: {
        status,
        series_ticker: seriesTicker,
        event_ticker: eventTicker,
        tickers: Array.isArray(tickers) ? tickers.join(',') : tickers,
        limit,
        cursor,
        min_close_ts: minCloseTs,
        max_close_ts: maxCloseTs,
        min_settled_ts: minSettledTs,
      },
    });
    return { markets: data?.markets ?? [], cursor: data?.cursor ?? '' };
  }

  /** Paginate GET /markets until exhausted (or maxPages). */
  async allMarkets(params = {}, { maxPages = 10 } = {}) {
    const out = [];
    let cursor;
    let pages = 0;
    do {
      const page = await this.markets({ ...params, cursor });
      out.push(...page.markets);
      cursor = page.cursor;
      pages += 1;
    } while (cursor && pages < maxPages);
    return out;
  }

  market(ticker) {
    return this.request('GET', `/markets/${encodeURIComponent(ticker)}`);
  }

  /** GET /events — limit max is 200 per the docs. */
  events({ status, seriesTicker, withNestedMarkets = true, limit = 200, cursor } = {}) {
    return this.request('GET', '/events', {
      query: {
        status,
        series_ticker: seriesTicker,
        with_nested_markets: withNestedMarkets,
        limit,
        cursor,
      },
    });
  }

  series(ticker) {
    return this.request('GET', `/series/${encodeURIComponent(ticker)}`);
  }

  seriesList({ category, includeProductMetadata } = {}) {
    return this.request('GET', '/series', {
      query: { category, include_product_metadata: includeProductMetadata },
    });
  }

  /**
   * GET /markets/{ticker}/orderbook — docs: arrays are [price_dollars, count_fp],
   * sorted ascending, best bid last; only bids are returned because a YES bid at X
   * equals a NO ask at 1-X.
   */
  async orderbook(ticker, { depth } = {}) {
    const data = await this.request('GET', `/markets/${encodeURIComponent(ticker)}/orderbook`, {
      query: { depth },
    });
    const ob = data?.orderbook_fp ?? data?.orderbook ?? {};
    return {
      yes: normalizeLevels(ob.yes_dollars ?? ob.yes ?? []),
      no: normalizeLevels(ob.no_dollars ?? ob.no ?? []),
      raw: data,
    };
  }

  /** GET /markets/trades — ms/s cursors per docs; min_ts/max_ts are SECONDS. */
  trades({ ticker, limit = 1000, minTs, maxTs, cursor } = {}) {
    return this.request('GET', '/markets/trades', {
      query: { ticker, limit, min_ts: minTs, max_ts: maxTs, cursor },
    });
  }

  /**
   * GET /series/{series_ticker}/markets/{ticker}/candlesticks
   * period_interval is minutes: 1, 60 or 1440. At most 5,000 periods per request.
   */
  candlesticks({ seriesTicker, ticker, startTs, endTs, periodIntervalMinutes = 1 }) {
    return this.request(
      'GET',
      `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
      { query: { start_ts: startTs, end_ts: endTs, period_interval: periodIntervalMinutes } },
    );
  }

  // ---- Portfolio (authenticated) -------------------------------------------

  balance() {
    return this.request('GET', '/portfolio/balance', { auth: true });
  }

  positions({ settlementStatus = 'all', limit = 200, cursor, countFilter = 'position' } = {}) {
    return this.request('GET', '/portfolio/positions', {
      auth: true,
      query: { settlement_status: settlementStatus, limit, cursor, count_filter: countFilter },
    });
  }

  fills({ limit = 100, cursor } = {}) {
    return this.request('GET', '/portfolio/fills', { auth: true, query: { limit, cursor } });
  }

  settlements({ limit = 100, cursor } = {}) {
    return this.request('GET', '/portfolio/settlements', { auth: true, query: { limit, cursor } });
  }

  orders({ status } = {}) {
    return this.request('GET', '/portfolio/orders', { auth: true, query: { status } });
  }

  /**
   * POST /portfolio/events/orders (Create Order V2).
   * The legacy /portfolio/orders write endpoints return 410 deprecated_v1_order_endpoint.
   * side is `bid` or `ask` (single book); price is fixed-point dollars as a string.
   */
  createOrder({ ticker, side, count, price, timeInForce = 'good_till_canceled', clientOrderId, selfTradePreventionType = 'taker_at_cross', exchangeIndex }) {
    const n = Number(count);
    return this.request('POST', '/portfolio/events/orders', {
      auth: true,
      body: {
        ticker,
        side,
        // Body shape verified 2026-11-20 against docs.kalshi.com/api-reference/orders/create-order-v2:
        // count and price are fixed-point strings (example: "10.00", "0.5600"), side is "bid"/"ask".
        count: Number.isFinite(n) ? n.toFixed(2) : String(count),
        price: String(price),
        time_in_force: timeInForce,
        self_trade_prevention_type: selfTradePreventionType,
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
        // exchange_index omitted unless explicitly provided: -1 is documented as auto-route for
        // CANCEL, not for create, so no default is invented here.
        ...(exchangeIndex === undefined ? {} : { exchange_index: exchangeIndex }),
      },
    });
  }

  cancelOrder({ orderId, marketTicker, exchangeIndex = -1 }) {
    return this.request('DELETE', `/portfolio/events/orders/${encodeURIComponent(orderId)}`, {
      auth: true,
      query: { market_ticker: marketTicker, exchange_index: exchangeIndex },
    });
  }
}

/** [[price, count], ...] -> [{ price, count }] with numbers, ascending by price. */
export function normalizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => {
      if (Array.isArray(level)) return { price: Number(level[0]), count: Number(level[1]) };
      return { price: Number(level.price ?? level[0]), count: Number(level.count ?? level[1]) };
    })
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.count))
    .sort((a, b) => a.price - b.price);
}

/**
 * Best bid/ask for the YES side, derived exactly as the official Orderbook Responses
 * page states: best YES ask = 1.00 - best NO bid.
 */
export function topOfBook({ yes, no }) {
  const bestYesBid = yes.length ? yes[yes.length - 1] : null;
  const bestNoBid = no.length ? no[no.length - 1] : null;
  return {
    yesBid: bestYesBid ? bestYesBid.price : null,
    yesBidSize: bestYesBid ? bestYesBid.count : null,
    yesAsk: bestNoBid ? round4(1 - bestNoBid.price) : null,
    yesAskSize: bestNoBid ? bestNoBid.count : null,
    noBid: bestNoBid ? bestNoBid.price : null,
    noBidSize: bestNoBid ? bestNoBid.count : null,
    noAsk: bestYesBid ? round4(1 - bestYesBid.price) : null,
  };
}

export function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

/** Midpoint of the yes book, falling back to the last trade when one side is empty. */
export function midPrice(book, lastPrice) {
  const top = topOfBook(book);
  if (top.yesBid !== null && top.yesAsk !== null) return round4((top.yesBid + top.yesAsk) / 2);
  if (top.yesBid !== null) return top.yesBid;
  if (top.yesAsk !== null) return top.yesAsk;
  return Number.isFinite(Number(lastPrice)) ? round4(lastPrice) : null;
}

/** Total contracts resting on the book, and the dollar notional of those rests. */
export function liquidity(book) {
  const contracts = book.yes.reduce((s, l) => s + l.count, 0) + book.no.reduce((s, l) => s + l.count, 0);
  const notional =
    book.yes.reduce((s, l) => s + l.count * l.price, 0) + book.no.reduce((s, l) => s + l.count * l.price, 0);
  return { contracts: round4(contracts), notionalDollars: Math.round(notional * 100) / 100 };
}

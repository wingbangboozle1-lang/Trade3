// A doc-faithful local stand-in for the Kalshi *demo* Trade API.
//
// WHY THIS EXISTS: the build sandbox has no route to Kalshi (see COORDINATION.md),
// so without this the dashboard, the alert engine, the paper trader and the order
// path could not be run or tested at all. It is a test double, never a data source
// of record, and the app labels it as such everywhere.
//
// FAITHFUL TO:
//   K1  host shape, /trade-api/v2 prefix
//   K3  KALSHI-ACCESS-* headers, timestamp window, signature verification
//   K5  orderbook shape: orderbook_fp { yes_dollars, no_dollars } as [price, count]
//       strings, ascending, bids only
//   K9  market object field names and fixed-point string types
//   K13 V2 order create shape + validation + 201 semantics
//   K14 cancel response { order_id, client_order_id, reduced_by }
//   K15 balance response { balance, balance_dollars, portfolio_value, updated_ts }
//   K16 positions { market_positions: [{ position_fp, ... }] }
//   K17 fills fields
//   K18/K19/K21 WebSocket message envelopes: { type, sid, seq?, msg }
//
// DELIBERATELY DIVERGENT (and disclosed):
//   * The price path is synthetic (seeded random walk + scripted shocks) so the
//     alert engine has something to bite on. Real demo prices are not reproducible.
//   * No real matching engine: orders fill immediately up to available depth.
//   * Only the endpoints the app uses are implemented; anything else returns a
//     RouteNotFound error so a typo in the client is caught instead of silently
//     passing.

import crypto from 'node:crypto';
import { makeRng, ticksToDollars, dollarsToTicks, TICKS_PER_DOLLAR } from '../lib/util.mjs';

const T = TICKS_PER_DOLLAR;

/* ------------------------------------------------------------------ fixtures */
// Series/events are keyed to the five requested topics. The series names are real
// Kalshi series tickers taken from the official fee schedule (K6) where one exists;
// the daily crypto and golf rows are synthetic tickers and are marked as such
// (`synthetic: true`) so nobody mistakes them for verified Kalshi products.
export const FIXTURE_SERIES = [
  { seriesTicker: 'KXAAAGASM', topic: 'gas', title: 'US gas price', synthetic: false, source: 'K6' },
  { seriesTicker: 'KXGASW', topic: 'gas', title: 'Weekly national average gas price', synthetic: true, source: 'synthetic' },
  { seriesTicker: 'KXELECTIRAN', topic: 'elections', title: 'Will Iran hold a presidential election?', synthetic: false, source: 'K6' },
  { seriesTicker: 'KXSENATE', topic: 'elections', title: 'US Senate seat markets', synthetic: true, source: 'synthetic' },
  { seriesTicker: 'KXEMMYCSERIES', topic: 'culture', title: 'Emmys Award for Comedy Series', synthetic: false, source: 'K6' },
  { seriesTicker: 'KXBALLONDOR', topic: 'culture', title: "Ballon d'Or", synthetic: false, source: 'K6' },
  { seriesTicker: 'KXBTCMAX150', topic: 'crypto', title: 'When will bitcoin hit 150k?', synthetic: false, source: 'K6' },
  { seriesTicker: 'KXETHY', topic: 'crypto', title: 'ETH price EOY', synthetic: false, source: 'K6' },
  { seriesTicker: 'KXPGA', topic: 'golf', title: 'PGA Tour winner', synthetic: true, source: 'synthetic' }
];

const EVENT_TEMPLATES = {
  gas: {
    event: { ticker: 'KXAAAGASM-26NOV', title: 'National average gas price in November 2026', subtitle: 'AAA national average' },
    markets: [
      { suffix: 'T3.05', title: 'Above $3.05', strike: 3.05, start: 0.52 },
      { suffix: 'T3.10', title: 'Above $3.10', strike: 3.1, start: 0.31 },
      { suffix: 'T3.15', title: 'Above $3.15', strike: 3.15, start: 0.14 }
    ]
  },
  elections: {
    event: { ticker: 'KXELECTIRAN-26', title: 'Iran presidential election in 2026', subtitle: 'Will Iran hold a presidential election?' },
    markets: [
      { suffix: 'Y', title: 'Iran holds a presidential election in 2026', start: 0.41 },
      { suffix: 'N', title: 'Iran does not hold a presidential election in 2026', start: 0.59 }
    ]
  },
  culture: {
    event: { ticker: 'KXEMMYCSERIES-26', title: 'Emmys Award for Comedy Series 2026', subtitle: 'Outstanding Comedy Series' },
    markets: [
      { suffix: 'SHOW1', title: 'Show A wins', start: 0.37 },
      { suffix: 'SHOW2', title: 'Show B wins', start: 0.28 },
      { suffix: 'SHOW3', title: 'Show C wins', start: 0.19 }
    ]
  },
  crypto: {
    event: { ticker: 'KXBTCMAX150-26', title: 'When will bitcoin hit $150k?', subtitle: 'BTC all-time high before 2027' },
    markets: [
      { suffix: 'DEC31', title: 'By Dec 31 2026', start: 0.46 },
      { suffix: 'JUN30', title: 'By Jun 30 2026', start: 0.22 }
    ]
  },
  golf: {
    event: { ticker: 'KXPGA-MASTERS26', title: 'Masters 2026 winner', subtitle: 'PGA Tour major' },
    markets: [
      { suffix: 'P1', title: 'Player A wins', start: 0.24 },
      { suffix: 'P2', title: 'Player B wins', start: 0.18 }
    ]
  }
};

function buildMarkets(nowSec = Math.floor(Date.now() / 1000)) {
  const markets = [];
  const events = [];
  for (const series of FIXTURE_SERIES) {
    const tpl = EVENT_TEMPLATES[series.topic];
    if (!tpl) continue;
    const eventTicker = tpl.event.ticker.replace(/\d{4}$/, '26');
    if (!events.find((e) => e.event_ticker === eventTicker)) {
      events.push({
        event_ticker: eventTicker,
        series_ticker: series.seriesTicker,
        title: tpl.event.title,
        sub_title: tpl.event.subtitle,
        mutually_exclusive: series.topic !== 'gas',
        markets: []
      });
    }
    for (const m of tpl.markets) {
      const ticker = `${eventTicker}-${m.suffix}`.replace(`${series.seriesTicker}-`, `${series.seriesTicker}-`);
      const existing = markets.find((x) => x.ticker === ticker);
      if (existing) continue;
      const price = Math.round(m.start * T);
      const market = {
        ticker,
        event_ticker: eventTicker,
        series_ticker: series.seriesTicker,
        title: `${tpl.event.title}`,
        subtitle: m.title,
        status: 'open',
        openSec: nowSec - 86_400 * 3,
        closeSec: nowSec + (series.topic === 'golf' ? 86_400 * 2 : 86_400 * 9),
        yesBidTicks: price - 10_000,
        yesAskTicks: price + 10_000,
        lastTicks: price,
        bidSize: 120,
        askSize: 95,
        volume: 4_000 + Math.floor(Math.random() * 900),
        volume24h: 300 + Math.floor(Math.random() * 200),
        openInterest: 1_200 + Math.floor(Math.random() * 400),
        liquidityTicks: Math.round((price / T) * 900 * T),
        result: '',
        settlementValueTicks: null,
        settlementTs: null,
        series,
        template: m
      };
      markets.push(market);
      const ev = events.find((e) => e.event_ticker === eventTicker);
      if (ev && !ev.markets.find((x) => x.ticker === ticker)) ev.markets.push({ ticker });
    }
  }
  return { markets, events };
}

/* -------------------------------------------------------------- order books */
function makeBook(market, rng) {
  const mid = market.lastTicks;
  const yes = [];
  const no = [];
  // Build 6 levels each side around the touch, with realistic-looking depth.
  for (let i = 0; i < 6; i += 1) {
    const bidTicks = Math.max(1_000, mid - 10_000 - i * 10_000);
    const yesCount = 20 + Math.floor(rng() * 180);
    yes.push([ticksToDollars(bidTicks, 4), yesCount.toFixed(2)]);
    const noBidTicks = Math.max(1_000, 1_000_000 - mid - 10_000 - i * 10_000);
    const noCount = 20 + Math.floor(rng() * 180);
    no.push([ticksToDollars(noBidTicks, 4), noCount.toFixed(2)]);
  }
  yes.sort((a, b) => Number(a[0]) - Number(b[0]));
  no.sort((a, b) => Number(a[0]) - Number(b[0]));
  return { yes_dollars: yes, no_dollars: no };
}

/* ------------------------------------------------------------------ exchange */
export class MockExchange {
  constructor({ seed = 7, auth = null, shockEveryMs = 45_000 } = {}) {
    this.rng = makeRng(seed);
    const { markets, events } = buildMarkets();
    this.markets = markets;
    this.events = events;
    this.books = new Map(markets.map((m) => [m.ticker, makeBook(m, this.rng)]));
    this.orders = new Map();
    this.fills = [];
    this.balanceCents = 100_000_000; // $1,000,000 of mock funds, clearly mock
    this.portfolioValueCents = 0;
    this.positions = new Map();
    this.auth = auth; // { keyId, publicPem, type } or null = accept anything
    this.shockEveryMs = shockEveryMs;
    this.lastShockAt = 0;
    this.seq = 0;
    this.startedAt = Date.now();
    this.requestLog = [];
  }

  /* --------------------------------------------------------------- auth (K3) */
  checkAuth(headers) {
    const key = headers['kalshi-access-key'];
    const ts = headers['kalshi-access-timestamp'];
    const sig = headers['kalshi-access-signature'];
    if (!this.auth) return { ok: true, anonymous: true };
    if (!key || !ts || !sig) return { ok: false, status: 401, code: 'missing_auth_headers' };
    const skew = Math.abs(Date.now() - Number(ts));
    if (!Number.isFinite(skew) || skew > 30_000) return { ok: false, status: 401, code: 'header_timestamp_expired' };
    if (key !== this.auth.keyId) return { ok: false, status: 401, code: 'unknown_key' };
    return { ok: true, needsSignature: { ts, sig } };
  }

  verifyRequestSignature(headers, method, path) {
    if (!this.auth) return true;
    const ts = headers['kalshi-access-timestamp'];
    const sig = headers['kalshi-access-signature'];
    const text = `${ts}${method}${String(path).split('?')[0]}`;
    const cryptoKey = crypto.createPublicKey({ key: this.auth.publicPem, format: 'pem' });
    const msg = Buffer.from(text, 'utf8');
    const signature = Buffer.from(sig, 'base64');
    if (cryptoKey.asymmetricKeyType === 'ed25519') return crypto.verify(null, msg, cryptoKey, signature);
    return crypto.verify(
      'sha256',
      msg,
      { key: cryptoKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
      signature
    );
  }

  /* ------------------------------------------------------------ serializers */
  marketJson(m) {
    const idx = 100 - Math.round(Math.random() * 0); // keep deterministic
    void idx;
    return {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      series_ticker: m.series_ticker,
      market_type: 'binary',
      title: m.title,
      subtitle: m.subtitle,
      yes_sub_title: m.subtitle,
      no_sub_title: m.subtitle,
      status: m.status,
      open_time: new Date(m.openSec * 1000).toISOString(),
      close_time: new Date(m.closeSec * 1000).toISOString(),
      latest_expiration_time: new Date(m.closeSec * 1000).toISOString(),
      yes_bid_dollars: ticksToDollars(m.yesBidTicks, 4),
      yes_ask_dollars: ticksToDollars(m.yesAskTicks, 4),
      yes_bid_size_fp: m.bidSize.toFixed(2),
      yes_ask_size_fp: m.askSize.toFixed(2),
      no_bid_dollars: ticksToDollars(1_000_000 - m.yesAskTicks, 4),
      no_ask_dollars: ticksToDollars(1_000_000 - m.yesBidTicks, 4),
      last_price_dollars: ticksToDollars(m.lastTicks, 4),
      previous_price_dollars: ticksToDollars(m.lastTicks, 4),
      volume_fp: m.volume.toFixed(2),
      volume_24h_fp: m.volume24h.toFixed(2),
      open_interest_fp: m.openInterest.toFixed(2),
      liquidity_dollars: ticksToDollars(m.liquidityTicks, 4),
      notional_value_dollars: ticksToDollars(1_000_000, 4),
      result: m.result || '',
      settlement_value_dollars: m.settlementValueTicks === null ? '' : ticksToDollars(m.settlementValueTicks, 4),
      settlement_ts: m.settlementTs ? new Date(m.settlementTs * 1000).toISOString() : null,
      can_close_early: true,
      rules_primary: 'Synthetic fixture for offline testing. Not a real Kalshi market.',
      rules_secondary: 'Resolution follows the fixture script, not reality.',
      price_level_structure: 'linear_cent',
      price_ranges: [{ start: '0.0100', end: '0.9900', step: '0.0100' }],
      exchange_index: 0
    };
  }

  eventJson(e) {
    return {
      event_ticker: e.event_ticker,
      series_ticker: e.series_ticker,
      title: e.title,
      sub_title: e.sub_title,
      mutually_exclusive: e.mutually_exclusive,
      collateral_return_type: e.mutually_exclusive ? 'MECNET' : 'DIRECNET',
      markets: e.markets.map((x) => this.marketJson(this.markets.find((mm) => mm.ticker === x.ticker))),
      settlement_sources: []
    };
  }

  /* --------------------------------------------------------------- REST ---- */
  async handle({ method, url, headers = {}, body = null }) {
    const u = new URL(url, 'http://mock.local');
    const p = u.pathname.replace(/^\/trade-api\/v2/, '');
    const q = u.searchParams;
    this.requestLog.push({ at: Date.now(), method, path: p });

    const auth = this.checkAuth(headers);
    const needsAuth = /^\/portfolio/.test(p);
    if (needsAuth && !auth.ok) return { status: auth.status, body: { error: { code: auth.code, message: 'auth failed' } } };
    if (needsAuth && this.auth && !this.verifyRequestSignature(headers, method, `/trade-api/v2${p}`)) {
      return { status: 401, body: { error: { code: 'bad_signature', message: 'signature did not verify' } } };
    }

    // --- exchange status (K23)
    if (p === '/exchange/status') {
      return { status: 200, body: { exchange_active: true, trading_active: true } };
    }

    // --- series (K12)
    if (p === '/series') {
      const series = FIXTURE_SERIES.map((s) => ({
        ticker: s.seriesTicker,
        frequency: 'monthly',
        title: s.title,
        category: s.topic[0].toUpperCase() + s.topic.slice(1),
        categories: [s.topic[0].toUpperCase() + s.topic.slice(1)],
        tags: [s.topic],
        settlement_sources: [{ name: 'Synthetic fixture', url: 'https://example.invalid' }],
        contract_url: '',
        contract_terms_url: '',
        fee_type: 'quadratic',
        fee_multiplier: 1,
        additional_prohibitions: [],
        volume_fp: '1000.00',
        last_updated_ts: new Date().toISOString(),
        exchange_index: 0,
        _synthetic: s.synthetic
      }));
      const category = q.get('category');
      return {
        status: 200,
        body: { series: category ? series.filter((s) => s.categories.includes(category)) : series }
      };
    }

    // --- events (K11)
    if (p === '/events') {
      const withMarkets = q.get('with_nested_markets') === 'true';
      const status = q.get('status');
      let evs = this.events.slice();
      if (status === 'open') evs = evs.filter((e) => e.markets.some((m) => this.markets.find((x) => x.ticker === m.ticker)?.status === 'open'));
      const out = evs.map((e) => (withMarkets ? this.eventJson(e) : { ...e, markets: undefined }));
      return { status: 200, body: { events: out, cursor: '' } };
    }

    // --- markets list (K9)
    if (p === '/markets') {
      let list = this.markets.slice();
      const seriesTicker = q.get('series_ticker');
      if (seriesTicker) list = list.filter((m) => m.series_ticker === seriesTicker);
      const eventTicker = q.get('event_ticker');
      if (eventTicker) list = list.filter((m) => m.event_ticker === eventTicker);
      const status = q.get('status');
      if (status) list = list.filter((m) => m.status === status);
      const limit = Math.min(Number(q.get('limit') || 200), 1000);
      return { status: 200, body: { markets: list.slice(0, limit).map((m) => this.marketJson(m)), cursor: '' } };
    }

    // --- single market (K9)
    const mm = p.match(/^\/markets\/([^/]+)$/);
    if (mm) {
      const m = this.markets.find((x) => x.ticker === decodeURIComponent(mm[1]));
      if (!m) return { status: 404, body: { error: { code: 'not_found', message: 'market not found' } } };
      return { status: 200, body: { market: this.marketJson(m) } };
    }

    // --- orderbook (K5, K10)
    const ob = p.match(/^\/markets\/([^/]+)\/orderbook$/);
    if (ob) {
      const ticker = decodeURIComponent(ob[1]);
      const book = this.books.get(ticker);
      // K5: unknown ticker returns 200 with empty arrays, not 404.
      if (!book) return { status: 200, body: { orderbook_fp: { yes_dollars: [], no_dollars: [] } } };
      const depth = Math.max(1, Math.min(Number(q.get('depth') || 10), 100));
      return {
        status: 200,
        body: {
          orderbook_fp: {
            yes_dollars: book.yes_dollars.slice(-depth),
            no_dollars: book.no_dollars.slice(-depth)
          }
        }
      };
    }

    // --- balance (K15)
    if (p === '/portfolio/balance') {
      return {
        status: 200,
        body: {
          balance: this.balanceCents,
          balance_dollars: (this.balanceCents / 100).toFixed(4),
          portfolio_value: this.portfolioValueCents,
          updated_ts: Math.floor(Date.now() / 1000),
          balance_breakdown: [{ exchange_index: 0, balance: (this.balanceCents / 100).toFixed(4) }]
        }
      };
    }

    // --- positions (K16)
    if (p === '/portfolio/positions') {
      return {
        status: 200,
        body: {
          cursor: '',
          market_positions: [...this.positions.entries()].map(([ticker, pos]) => ({
            ticker,
            exchange_index: 0,
            total_traded_dollars: ((pos.contracts * pos.avgTicks) / T).toFixed(4),
            position_fp: (pos.side === 'yes' ? pos.contracts : -pos.contracts).toFixed(2),
            market_exposure_dollars: ((pos.contracts * pos.avgTicks) / T).toFixed(4),
            realized_pnl_dollars: (pos.realized / T).toFixed(4),
            fees_paid_dollars: (pos.fees / T).toFixed(4),
            last_updated_ts: Math.floor(Date.now() / 1000),
            netting_enabled: false
          })),
          event_positions: []
        }
      };
    }

    // --- fills (K17)
    if (p === '/portfolio/fills') {
      return { status: 200, body: { fills: this.fills.slice(-200), cursor: '' } };
    }

    // --- create order V2 (K13)
    if (p === '/portfolio/events/orders' && method === 'POST') {
      return this.createOrder(body || {});
    }

    // --- cancel order V2 (K14)
    const cancel = p.match(/^\/portfolio\/events\/orders\/([^/]+)$/);
    if (cancel && method === 'DELETE') {
      const id = decodeURIComponent(cancel[1]);
      const o = this.orders.get(id);
      if (!o) return { status: 404, body: { error: { code: 'not_found', message: 'order not found' } } };
      const reduced = o.remaining;
      o.remaining = 0;
      o.status = 'canceled';
      return { status: 200, body: { order_id: id, client_order_id: o.clientOrderId || '', reduced_by: reduced.toFixed(2) } };
    }

    return { status: 404, body: { error: { code: 'route_not_found', message: `mock has no route for ${method} ${p}` } } };
  }

  /* ------------------------------------------------------- order handling --- */
  createOrder(body) {
    // Validation mirrors K13's documented requirements.
    const required = ['ticker', 'side', 'count', 'price', 'time_in_force', 'self_trade_prevention_type'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        return { status: 400, body: { error: { code: 'missing_field', message: `missing ${f}` } } };
      }
    }
    if (!['bid', 'ask'].includes(body.side)) {
      return { status: 400, body: { error: { code: 'invalid_side', message: 'side must be bid or ask' } } };
    }
    if (!['fill_or_kill', 'good_till_canceled', 'immediate_or_cancel'].includes(body.time_in_force)) {
      return { status: 400, body: { error: { code: 'invalid_time_in_force', message: 'bad tif' } } };
    }
    if (body.reduce_only && body.time_in_force !== 'immediate_or_cancel') {
      return { status: 400, body: { error: { code: 'reduce_only_requires_ioc', message: 'reduce_only needs immediate_or_cancel (K13)' } } };
    }
    const market = this.markets.find((m) => m.ticker === body.ticker);
    if (!market) return { status: 404, body: { error: { code: 'market_not_found', message: 'no such market' } } };
    if (market.status !== 'open') return { status: 400, body: { error: { code: 'market_closed', message: 'market not open' } } };

    const priceTicks = dollarsToTicks(body.price);
    const count = Math.round(Number(body.count) * 100) / 100;
    if (!(priceTicks > 0 && priceTicks < T)) {
      return { status: 400, body: { error: { code: 'invalid_price', message: 'price out of range' } } };
    }
    if (!(count > 0)) return { status: 400, body: { error: { code: 'invalid_count', message: 'count must be > 0' } } };

    // Immediate fill against the resting book, using the documented reciprocity:
    // buying YES lifts the best NO bid at 1-p, i.e. pays the implied YES ask (K5).
    const book = this.books.get(market.ticker);
    let fillable = 0;
    let cashCost = 0;
    if (body.side === 'bid') {
      // walk the NO side from the best (last) down
      let need = count;
      for (let i = book.no_dollars.length - 1; i >= 0 && need > 0; i -= 1) {
        const [pStr, cStr] = book.no_dollars[i];
        const askTicks = 1_000_000 - dollarsToTicks(pStr);
        const avail = Number(cStr);
        const take = Math.min(need, avail);
        fillable += take;
        cashCost += take * askTicks;
        need -= take;
      }
    } else {
      let need = count;
      for (let i = book.yes_dollars.length - 1; i >= 0 && need > 0; i -= 1) {
        const [pStr, cStr] = book.yes_dollars[i];
        const bidTicks = dollarsToTicks(pStr);
        const avail = Number(cStr);
        const take = Math.min(need, avail);
        fillable += take;
        cashCost += take * bidTicks;
        need -= take;
      }
    }

    const orderId = crypto.randomUUID();
    const remaining = Math.max(0, count - fillable);
    const order = {
      orderId,
      clientOrderId: body.client_order_id || '',
      ticker: body.ticker,
      side: body.side,
      priceTicks,
      count,
      filled: fillable,
      remaining,
      status: remaining === 0 ? 'executed' : 'resting',
      createdAt: Date.now()
    };
    this.orders.set(orderId, order);

    if (fillable > 0) {
      const avgTicks = Math.round(cashCost / fillable);
      this.balanceCents -= Math.round((cashCost / T) * 100);
      const key = body.ticker;
      const pos = this.positions.get(key) || { contracts: 0, avgTicks: 0, side: 'yes', realized: 0, fees: 0 };
      pos.side = body.side === 'bid' ? 'yes' : 'no';
      pos.avgTicks = Math.round((pos.avgTicks * pos.contracts + avgTicks * fillable) / (pos.contracts + fillable));
      pos.contracts += fillable;
      this.positions.set(key, pos);
      this.fills.push({
        fill_id: crypto.randomUUID(),
        order_id: orderId,
        ticker: body.ticker,
        outcome_side: body.side === 'bid' ? 'yes' : 'no',
        book_side: body.side,
        count_fp: fillable.toFixed(2),
        yes_price_dollars: ticksToDollars(body.side === 'bid' ? avgTicks : 1_000_000 - avgTicks, 4),
        no_price_dollars: ticksToDollars(body.side === 'bid' ? 1_000_000 - avgTicks : avgTicks, 4),
        is_taker: true,
        created_time: new Date().toISOString(),
        fee_cost: '0.0000',
        ts: Math.floor(Date.now() / 1000)
      });
    }
    if (body.time_in_force === 'fill_or_kill' && remaining > 0) {
      order.status = 'canceled';
      return { status: 409, body: { error: { code: 'fill_or_kill_insufficient_liquidity', message: 'not enough depth' } } };
    }

    return {
      status: 201,
      body: {
        order_id: orderId,
        client_order_id: body.client_order_id || '',
        fill_count: fillable.toFixed(2),
        remaining_count: remaining.toFixed(2),
        ts_ms: Date.now()
      }
    };
  }

  /* ------------------------------------------------------------ simulation - */
  /**
   * Advance the synthetic market by one step. Returns the WS-shaped messages the
   * server should broadcast, so the real WS handling path is exercised.
   */
  step(nowMs = Date.now()) {
    const out = [];
    const rng = this.rng;
    const shockDue = nowMs - this.lastShockAt > this.shockEveryMs;
    if (shockDue) this.lastShockAt = nowMs;

    // Pick which markets (if any) get a scripted shock this window. Shocking every
    // market at once produced a firehose of alerts that no human could read, which
    // defeats the purpose of the dashboard.
    const openMarkets = this.markets.filter((m) => m.status === 'open');
    const shockTargets = new Set();
    if (shockDue && openMarkets.length) {
      const k = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < k; i += 1) {
        shockTargets.add(openMarkets[Math.floor(rng() * openMarkets.length)].ticker);
      }
    }

    for (const m of openMarkets) {
      // Realistic tick behaviour: most updates are not a price change at all, and
      // when the price does move it moves about a cent. Without this the synthetic
      // market produced ~16 alerts a minute, which is not a usable alert feed and
      // would flatter or punish strategies for reasons that only exist in the mock.
      const moves = rng() < 0.08;
      const drift = moves ? (rng() < 0.5 ? -10_000 : 10_000) : 0;
      let shock = 0;
      if (shockTargets.has(m.ticker)) {
        shock = (rng() < 0.5 ? -1 : 1) * (100_000 + Math.floor(rng() * 130_000));
      }
      const next = Math.max(10_000, Math.min(990_000, m.lastTicks + drift + shock));
      if (next !== m.lastTicks) {
        m.lastTicks = next;
        m.yesBidTicks = Math.max(1_000, next - 10_000);
        m.yesAskTicks = Math.min(999_000, next + 10_000);
        m.volume += 1 + Math.floor(rng() * 4);
        m.volume24h += 1;
        this.seq += 1;
        const tsMs = nowMs;
        out.push({
          type: 'trade',
          sid: 1,
          seq: this.seq,
          msg: {
            trade_id: crypto.randomUUID(),
            market_ticker: m.ticker,
            yes_price_dollars: ticksToDollars(next, 4),
            no_price_dollars: ticksToDollars(1_000_000 - next, 4),
            count_fp: (1 + Math.floor(rng() * 25)).toFixed(2),
            taker_side: rng() < 0.5 ? 'yes' : 'no',
            taker_outcome_side: rng() < 0.5 ? 'yes' : 'no',
            taker_book_side: rng() < 0.5 ? 'bid' : 'ask',
            is_block_trade: false,
            ts: Math.floor(tsMs / 1000),
            ts_ms: tsMs
          }
        });
        out.push({
          type: 'ticker',
          sid: 2,
          msg: {
            market_id: m.ticker,
            market_ticker: m.ticker,
            price_dollars: ticksToDollars(next, 4),
            yes_bid_dollars: ticksToDollars(m.yesBidTicks, 4),
            yes_ask_dollars: ticksToDollars(m.yesAskTicks, 4),
            yes_bid_size_fp: (30 + Math.floor(rng() * 200)).toFixed(2),
            yes_ask_size_fp: (30 + Math.floor(rng() * 200)).toFixed(2),
            volume_fp: m.volume.toFixed(2),
            open_interest_fp: m.openInterest.toFixed(2),
            dollar_volume: Math.round((m.volume * next) / T),
            dollar_open_interest: Math.round((m.openInterest * next) / T),
            last_trade_size_fp: (1 + Math.floor(rng() * 25)).toFixed(2),
            ts: Math.floor(tsMs / 1000),
            ts_ms: tsMs
          }
        });
        if (shockTargets.has(m.ticker)) {
          this.books.set(m.ticker, makeBook(m, rng));
          out.push({
            type: 'orderbook_snapshot',
            sid: 3,
            seq: this.seq,
            msg: { market_ticker: m.ticker, ...this.books.get(m.ticker) }
          });
        }
      }
    }

    // Scripted resolutions: markets near their close eventually resolve.
    for (const m of this.markets) {
      if (m.status !== 'open') continue;
      const remaining = m.closeSec * 1000 - nowMs;
      if (remaining < 120_000 && rng() < 0.02) {
        const result = rng() < m.lastTicks / T ? 'yes' : 'no';
        m.status = 'settled';
        m.result = result;
        m.settlementValueTicks = result === 'yes' ? T : 0;
        m.settlementTs = Math.floor(nowMs / 1000);
        this.seq += 1;
        out.push({
          type: 'market_lifecycle_v2',
          sid: 4,
          seq: this.seq,
          msg: {
            market_ticker: m.ticker,
            event_type: 'determined',
            result,
            settlement_value: ticksToDollars(result === 'yes' ? T : 0, 4),
            determination_ts: Math.floor(nowMs / 1000)
          }
        });
        out.push({
          type: 'market_lifecycle_v2',
          sid: 4,
          seq: this.seq,
          msg: { market_ticker: m.ticker, event_type: 'settled', settled_ts: Math.floor(nowMs / 1000) }
        });
      }
    }
    return out;
  }

  /** Force a specific price move; used by tests so they are deterministic. */
  forceMove(ticker, deltaTicks, atMs = Date.now()) {
    const m = this.markets.find((x) => x.ticker === ticker);
    if (!m) throw new Error(`no fixture market ${ticker}`);
    const next = Math.max(10_000, Math.min(990_000, m.lastTicks + deltaTicks));
    m.lastTicks = next;
    m.yesBidTicks = Math.max(1_000, next - 10_000);
    m.yesAskTicks = Math.min(999_000, next + 10_000);
    this.seq += 1;
    return {
      type: 'trade',
      sid: 1,
      seq: this.seq,
      msg: {
        trade_id: crypto.randomUUID(),
        market_ticker: ticker,
        yes_price_dollars: ticksToDollars(next, 4),
        no_price_dollars: ticksToDollars(1_000_000 - next, 4),
        count_fp: '10.00',
        taker_side: deltaTicks > 0 ? 'yes' : 'no',
        taker_outcome_side: deltaTicks > 0 ? 'yes' : 'no',
        taker_book_side: deltaTicks > 0 ? 'bid' : 'ask',
        is_block_trade: false,
        ts: Math.floor(atMs / 1000),
        ts_ms: atMs
      }
    };
  }
}

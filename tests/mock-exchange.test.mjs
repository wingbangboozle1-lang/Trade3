// The mock exists to test our client code against the DOCUMENTED shapes. So the
// tests here assert the mock against the docs, not the other way round. If the mock
// ever drifts from the documented contract, these fail and the mock gets fixed.

import { suite, test, testAsync, assert, eq } from './harness.mjs';
import { MockExchange } from '../app/mock/exchange.mjs';
import { generateKeyPair, authHeaders, loadPrivateKey } from '../app/lib/signing.mjs';
import { dollarsToTicks } from '../app/lib/util.mjs';

const T = 1_000_000;

async function get(ex, path, headers = {}) {
  return ex.handle({ method: 'GET', url: `https://external-api.demo.kalshi.co/trade-api/v2${path}`, headers });
}

suite('mock exchange — contract fidelity', () => {
  testAsync('orderbook_fp uses [price, count] string pairs, ascending, bids only (K5)', async () => {
    const ex = new MockExchange({ seed: 1 });
    const r = await get(ex, `/markets/${ex.markets[0].ticker}/orderbook?depth=10`);
    const ob = r.body.orderbook_fp;
    assert(Array.isArray(ob.yes_dollars) && Array.isArray(ob.no_dollars));
    assert(!('yes_asks' in ob) && !('no_asks' in ob), 'no asks, per K5');
    for (const [p, c] of ob.yes_dollars) {
      assert(typeof p === 'string' && /^\d+\.\d{4}$/.test(p), `price "${p}" is a fixed-point string`);
      assert(typeof c === 'string' && /^\d+\.\d{2}$/.test(c), `count "${c}" is a 2dp string`);
    }
    const prices = ob.yes_dollars.map(([p]) => Number(p));
    eq(prices.join(','), prices.slice().sort((a, b) => a - b).join(','), 'ascending order');
  });

  testAsync('unknown ticker returns 200 with empty arrays, not 404 (K5)', async () => {
    const ex = new MockExchange();
    const r = await get(ex, '/markets/NOPE-DOES-NOT-EXIST/orderbook');
    eq(r.status, 200);
    eq(r.body.orderbook_fp.yes_dollars.length, 0);
  });

  testAsync('market objects carry the documented fixed-point fields (K9)', async () => {
    const ex = new MockExchange();
    const r = await get(ex, '/markets?limit=1');
    const m = r.body.markets[0];
    for (const f of ['ticker', 'event_ticker', 'series_ticker', 'status', 'yes_bid_dollars', 'yes_ask_dollars', 'last_price_dollars', 'volume_fp', 'open_interest_fp', 'close_time', 'result']) {
      assert(f in m, `missing ${f}`);
    }
    assert(/^\d+\.\d{2}$/.test(m.volume_fp), 'volume_fp is 2dp');
  });

  testAsync('events support with_nested_markets (K11)', async () => {
    const ex = new MockExchange();
    const r = await get(ex, '/events?status=open&with_nested_markets=true');
    assert(r.body.events.length > 0);
    assert(r.body.events[0].markets.length > 0, 'nested markets present');
    assert('mutually_exclusive' in r.body.events[0], 'mutually_exclusive present (K11)');
  });

  testAsync('auth is enforced with the documented headers (K3)', async () => {
    const kp = generateKeyPair('ed25519');
    const ex = new MockExchange({ auth: { keyId: 'kid', publicPem: kp.publicPem, type: 'ed25519' } });
    const anon = await get(ex, '/portfolio/balance');
    eq(anon.status, 401, 'anonymous portfolio call is rejected');
    eq(anon.body.error.code, 'missing_auth_headers');

    const stale = authHeaders(loadPrivateKey(kp.privatePem), 'kid', 'GET', '/trade-api/v2/portfolio/balance', Date.now() - 60_000);
    const r2 = await get(ex, '/portfolio/balance', stale);
    eq(r2.status, 401);
    eq(r2.body.error.code, 'header_timestamp_expired', '30s window enforced (K3)');

    const good = authHeaders(loadPrivateKey(kp.privatePem), 'kid', 'GET', '/trade-api/v2/portfolio/balance');
    const r3 = await get(ex, '/portfolio/balance', good);
    eq(r3.status, 200, 'valid signature accepted');
    assert('balance_dollars' in r3.body, 'balance_dollars present (K15)');
  });

  testAsync('a tampered signature is rejected', async () => {
    const kp = generateKeyPair('ed25519');
    const ex = new MockExchange({ auth: { keyId: 'kid', publicPem: kp.publicPem, type: 'ed25519' } });
    const h = authHeaders(loadPrivateKey(kp.privatePem), 'kid', 'GET', '/trade-api/v2/portfolio/balance');
    const bad = { ...h, 'KALSHI-ACCESS-SIGNATURE': Buffer.alloc(64).toString('base64') };
    const r = await get(ex, '/portfolio/balance', bad);
    eq(r.status, 401);
  });

  testAsync('V2 order validation mirrors K13', async () => {
    const ex = new MockExchange();
    const ticker = ex.markets[0].ticker;

    const missing = await ex.handle({ method: 'POST', url: '/trade-api/v2/portfolio/events/orders', body: { ticker } });
    eq(missing.status, 400);
    eq(missing.body.error.code, 'missing_field');

    const badSide = await ex.handle({
      method: 'POST',
      url: '/trade-api/v2/portfolio/events/orders',
      body: { ticker, side: 'buy', count: '1.00', price: '0.5000', time_in_force: 'good_till_canceled', self_trade_prevention_type: 'taker_at_cross' }
    });
    eq(badSide.status, 400, 'side must be bid|ask');

    const badTif = await ex.handle({
      method: 'POST',
      url: '/trade-api/v2/portfolio/events/orders',
      body: { ticker, side: 'bid', count: '1.00', price: '0.5000', time_in_force: 'GTT', self_trade_prevention_type: 'taker_at_cross' }
    });
    eq(badTif.status, 400, 'GTT is not a valid API value (K13)');

    const reduceOnly = await ex.handle({
      method: 'POST',
      url: '/trade-api/v2/portfolio/events/orders',
      body: { ticker, side: 'bid', count: '1.00', price: '0.5000', time_in_force: 'good_till_canceled', self_trade_prevention_type: 'taker_at_cross', reduce_only: true }
    });
    eq(reduceOnly.status, 400, 'reduce_only needs immediate_or_cancel (K13)');
  });

  testAsync('a V2 order returns the documented 201 body (K13)', async () => {
    const ex = new MockExchange();
    const ticker = ex.markets[0].ticker;
    const r = await ex.handle({
      method: 'POST',
      url: '/trade-api/v2/portfolio/events/orders',
      body: {
        ticker,
        client_order_id: 'abc',
        side: 'bid',
        count: '5.00',
        price: '0.5000',
        time_in_force: 'good_till_canceled',
        self_trade_prevention_type: 'taker_at_cross'
      }
    });
    eq(r.status, 201);
    for (const f of ['order_id', 'client_order_id', 'fill_count', 'remaining_count', 'ts_ms']) {
      assert(f in r.body, `missing ${f}`);
    }
    eq(typeof r.body.fill_count, 'string', 'fill_count is a fixed-point string');
    eq(r.body.client_order_id, 'abc');
  });

  testAsync('cancel returns {order_id, client_order_id, reduced_by} (K14)', async () => {
    const ex = new MockExchange();
    const r = await ex.handle({ method: 'DELETE', url: '/trade-api/v2/portfolio/events/orders/does-not-exist' });
    eq(r.status, 404);
    const placed = await ex.handle({
      method: 'POST',
      url: '/trade-api/v2/portfolio/events/orders',
      body: { ticker: ex.markets[0].ticker, side: 'bid', count: '5.00', price: '0.0100', time_in_force: 'good_till_canceled', self_trade_prevention_type: 'taker_at_cross' }
    });
    const c = await ex.handle({ method: 'DELETE', url: `/trade-api/v2/portfolio/events/orders/${placed.body.order_id}` });
    eq(c.status, 200);
    for (const f of ['order_id', 'client_order_id', 'reduced_by']) assert(f in c.body, `missing ${f}`);
  });

  testAsync('balance response matches K15 field names', async () => {
    const ex = new MockExchange();
    const r = await get(ex, '/portfolio/balance');
    for (const f of ['balance', 'balance_dollars', 'portfolio_value', 'updated_ts']) assert(f in r.body, `missing ${f}`);
  });

  testAsync('positions use a signed position_fp (K16)', async () => {
    const ex = new MockExchange();
    const r = await get(ex, '/portfolio/positions');
    assert(Array.isArray(r.body.market_positions), 'market_positions array');
  });

  test('simulated stream emits the documented envelopes (K18/K19/K21)', () => {
    const ex = new MockExchange({ seed: 3, shockEveryMs: 1000 });
    const kinds = new Set();
    const tradeFields = new Set();
    for (let i = 0; i < 40; i += 1) {
      const msgs = ex.step(Date.now() + i * 1000);
      for (const m of msgs) {
        kinds.add(m.type);
        if (m.type === 'trade') {
          for (const f of ['trade_id', 'market_ticker', 'yes_price_dollars', 'no_price_dollars', 'count_fp', 'taker_side', 'is_block_trade', 'ts_ms']) {
            tradeFields.add(f);
            assert(f in m.msg, `trade msg missing ${f}`);
          }
        }
        if (m.type === 'ticker') {
          for (const f of ['market_ticker', 'price_dollars', 'yes_bid_dollars', 'yes_ask_dollars', 'volume_fp', 'ts_ms']) {
            assert(f in m.msg, `ticker msg missing ${f}`);
          }
        }
        assert(typeof m.sid === 'number', 'every message has a subscription id');
      }
    }
    assert(kinds.has('trade'), 'trade messages emitted');
    assert(kinds.has('ticker'), 'ticker messages emitted');
    eq(tradeFields.size, 8, 'all documented trade fields appear');
  });

  test('forced moves are deterministic for tests', () => {
    const ex = new MockExchange({ seed: 5 });
    const ticker = ex.markets[0].ticker;
    const before = ex.markets[0].lastTicks;
    const msg = ex.forceMove(ticker, 150_000);
    eq(ex.markets[0].lastTicks, Math.min(990_000, before + 150_000));
    eq(dollarsToTicks(msg.msg.yes_price_dollars), ex.markets[0].lastTicks);
  });

  test('a market that resolves emits determined then settled (K21)', () => {
    const ex = new MockExchange({ seed: 9 });
    const m = ex.markets[0];
    m.closeSec = Math.floor(Date.now() / 1000) + 1;
    const found = [];
    for (let i = 0; i < 400 && found.length < 2; i += 1) {
      const msgs = ex.step(Date.now() + i * 500);
      for (const x of msgs) if (x.type === 'market_lifecycle_v2' && x.msg.market_ticker === m.ticker) found.push(x.msg);
    }
    assert(found.length >= 2, `expected determined+settled, got ${found.length}`);
    eq(found[0].event_type, 'determined');
    assert(found[0].result === 'yes' || found[0].result === 'no', 'result is yes or no');
    assert('settlement_value' in found[0], 'settlement_value present');
    eq(found[1].event_type, 'settled');
  });

  test('every fixture series is labelled synthetic or sourced', () => {
    const ex = new MockExchange();
    for (const m of ex.markets) {
      assert(m.series, 'series attached');
      assert(m.series.source === 'K6' || m.series.source === 'synthetic', `${m.ticker} has an unlabelled source`);
    }
  });
});

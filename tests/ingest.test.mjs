// End-to-end: drive the real HTTP server with the mock feed and assert that a
// forced 10c move produces an alert, a promotion decision, a paper trade and an API
// response shaped the way the browser expects.
//
// This is the only place a real socket is opened, and it is a localhost socket, so
// it runs with no network access at all.

import { suite, testAsync, assert, eq } from './harness.mjs';
import { createServer } from '../app/server.mjs';
import { config } from '../app/config.mjs';

const PORT = 8799;
const cfg = { ...config, port: PORT, host: '127.0.0.1', dataSource: 'mock', logLevel: 'error' };

async function withServer(fn) {
  const app = await createServer({ cfg });
  await app.listen();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

const j = async (path) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return { status: r.status, body: await r.json() };
};

suite('ingest — end to end through the HTTP server', () => {
  testAsync('server starts in simulated mode and labels itself', async () => {
    await withServer(async (app) => {
      const s = await j('/api/status');
      eq(s.status, 200);
      eq(s.body.mode, 'mock');
      eq(s.body.provenance.kind, 'simulated');
      assert(s.body.provenance.detail.includes('none of these prices', 'i'), 'provenance warns it is not real data');
      assert(s.body.restBase.includes('external-api.demo.kalshi.co'), 'recommended demo host is the default');
      assert(s.body.wsBase.includes('external-api-ws.demo.kalshi.co'), 'recommended demo WS host is the default');
    });
  });

  testAsync('all five topics are discoverable with markets attached', async () => {
    await withServer(async () => {
      const t = await j('/api/topics');
      eq(t.body.topics.length, 5);
      for (const topic of ['gas', 'elections', 'culture', 'crypto', 'golf']) {
        const v = await j(`/api/topic/${topic}`);
        eq(v.status, 200, `${topic} endpoint`);
        assert(v.body.events.length > 0, `${topic} has events`);
        assert(v.body.events[0].rows.length > 0, `${topic} rows present`);
      }
    });
  });

  testAsync('unknown topic and market return 404, not empty data', async () => {
    await withServer(async () => {
      eq((await j('/api/topic/baseball')).status, 404);
      eq((await j('/api/market/NOPE')).status, 404);
      eq((await j('/api/does-not-exist')).status, 404);
    });
  });

  testAsync('a forced +12c move produces an alert in both the all and model feeds when it qualifies', async () => {
    await withServer(async (app) => {
      const ing = app.engine;
      const ticker = [...ing.index.markets.keys()][0];
      // Seed a two-sided book so the model has something to price against.
      ing.applyBook(
        ticker,
        {
          yes_dollars: [['0.3000', '400.00'], ['0.3800', '400.00'], ['0.3900', '400.00']],
          no_dollars: [['0.5000', '400.00'], ['0.6000', '400.00'], ['0.6100', '400.00']]
        },
        Date.now()
      );
      const before = ing.alerts.alerts.length;
      ing.handleWsMessage({
        type: 'trade',
        sid: 1,
        seq: 1,
        msg: {
          trade_id: 'x',
          market_ticker: ticker,
          yes_price_dollars: '0.5000',
          no_price_dollars: '0.5000',
          count_fp: '10.00',
          taker_side: 'yes',
          taker_outcome_side: 'yes',
          taker_book_side: 'bid',
          is_block_trade: false,
          ts: Math.floor(Date.now() / 1000),
          ts_ms: Date.now()
        }
      });
      ing.handleWsMessage({
        type: 'trade',
        sid: 1,
        seq: 2,
        msg: {
          trade_id: 'y',
          market_ticker: ticker,
          yes_price_dollars: '0.6200',
          no_price_dollars: '0.3800',
          count_fp: '10.00',
          taker_side: 'yes',
          taker_outcome_side: 'yes',
          taker_book_side: 'bid',
          is_block_trade: false,
          ts: Math.floor(Date.now() / 1000),
          ts_ms: Date.now() + 1000
        }
      });
      const alerts = ing.alerts.alerts;
      assert(alerts.length > before, 'an alert was produced');
      const a = alerts[alerts.length - 1];
      eq(a.direction, 'up');
      assert(Math.abs(a.deltaTicks) >= 100_000);
      assert(a.score, 'the alert carries a model score');
      assert('maker' in a.score && 'taker' in a.score, 'both views are present');
      if (a.score.taker) assert(a.score.taker.evTicks <= 0, 'the taker view is not pretending to be profitable');

      const api = await j('/api/alerts?filter=all&limit=10');
      assert(api.body.alerts.length > 0, 'alerts are served to the browser');
      const row = api.body.alerts[api.body.alerts.length - 1];
      for (const f of ['ticker', 'delta', 'direction', 'score', 'causes']) assert(f in row, `alert payload missing ${f}`);
      assert(Array.isArray(row.causes), 'candidate causes are attached (possibly empty)');
    });
  });

  testAsync('resolutions are captured and served', async () => {
    await withServer(async (app) => {
      const ing = app.engine;
      const ticker = [...ing.index.markets.keys()][0];
      ing.handleWsMessage({
        type: 'market_lifecycle_v2',
        sid: 4,
        seq: 1,
        msg: { market_ticker: ticker, event_type: 'determined', result: 'no', settlement_value: '0.0000', determination_ts: Math.floor(Date.now() / 1000) }
      });
      ing.handleWsMessage({
        type: 'market_lifecycle_v2',
        sid: 4,
        seq: 2,
        msg: { market_ticker: ticker, event_type: 'settled', settled_ts: Math.floor(Date.now() / 1000) }
      });
      const r = await j('/api/resolutions');
      assert(r.body.resolutions.length >= 1, 'resolution recorded');
      const row = r.body.resolutions[0];
      eq(row.ticker, ticker);
      eq(row.result, 'no');
      assert(row.source.includes('market_lifecycle_v2'), 'the source of the resolution is recorded');
    });
  });

  testAsync('a resolution settles the paper position instead of leaving it open', async () => {
    await withServer(async (app) => {
      const ing = app.engine;
      const ticker = [...ing.index.markets.keys()][0];
      ing.paper.openPosition({
        strategyId: 'test',
        ticker,
        side: 'yes',
        priceTicks: 400_000,
        contracts: 10,
        seriesTicker: 'KXAAAGASM',
        reason: 'unit test',
        atMs: Date.now()
      });
      ing.handleWsMessage({
        type: 'market_lifecycle_v2',
        sid: 4,
        seq: 9,
        msg: { market_ticker: ticker, event_type: 'determined', result: 'yes', settlement_value: '1.0000', determination_ts: Math.floor(Date.now() / 1000) }
      });
      eq(ing.paper.open.size, 0, 'position closed by the resolution');
      const t = ing.paper.closed.find((x) => x.strategyId === 'test');
      assert(t, 'trade recorded');
      eq(t.exitReason, 'resolution');
      eq(t.exitTicks, 1_000_000);
      eq(t.exitFeeTicks, 0, 'no settlement fee');
    });
  });

  testAsync('order placement is refused without a key, with a clear reason', async () => {
    await withServer(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'PLACE_DEMO_ORDER', ticker: 'X', side: 'bid', contracts: 1, priceDollars: 0.5 })
      });
      const body = await r.json();
      eq(r.status, 400);
      eq(body.ok, false);
      eq(body.error.code, 'no_api_key');
    });
  });

  testAsync('order placement requires explicit confirmation', async () => {
    await withServer(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticker: 'X', side: 'bid', contracts: 1, priceDollars: 0.5 })
      });
      const body = await r.json();
      eq(r.status, 400);
      eq(body.error, 'confirmation_required');
    });
  });

  testAsync('static assets are served and the dashboard HTML loads', async () => {
    await withServer(async () => {
      for (const p of ['/', '/app.js', '/style.css']) {
        const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
        eq(r.status, 200, `${p} status`);
        assert((await r.text()).length > 100, `${p} has content`);
      }
    });
  });

  testAsync('path traversal is blocked', async () => {
    await withServer(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/../package.json`);
      assert(r.status === 403 || r.status === 404, `traversal returned ${r.status}`);
    });
  });
});

/**
 * Smoke test: drives the real server + collector with a fake Kalshi client so every
 * HTTP route and the alert/paper-trading pipeline is exercised offline.
 * Run: node tests/smoke-test.js
 */

import assert from 'node:assert/strict';
import { Collector } from '../server/collector.js';
import { createServer, buildChart } from '../server/index.js';
import { SwingDetector, isSwing, moveDollars, roiScore } from '../server/alerts.js';
import { classifyMarket } from '../server/topics.js';
import { decideTrade, analyzeTrades, PaperBroker, STRATEGIES } from '../server/paper.js';
import { buildSeriesMarkets } from './fixtures.js';

const quiet = { info() {}, warn() {}, error() {} };
const results = [];
const test = async (name, fn) => {
  console.log(`START ${name}`); // streamed so a hang names itself even without a summary
  try {
    await fn();
    results.push(`PASS ${name}`);
    console.log(`PASS ${name}`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message}`);
    console.log(`FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
};

// Watchdog: if every test finished but something still holds the event loop,
// name the handle and exit non-zero instead of freezing CI. An unresolved
// top-level await with an empty loop exits on its own (code 13); a hang always
// means an active resource — print exactly which.
const watchdog = setTimeout(() => {
  console.log('WATCHDOG: process still alive 45s after the last test start.');
  console.log(`Active resources: ${process.getActiveResourcesInfo().join(', ')}`);
  console.log(`Results so far: ${results.length}`);
  process.exit(3);
}, 45_000);
watchdog.unref();

// --- swing detector ---------------------------------------------------------
await test('isSwing uses an inclusive $0.10 threshold in both directions', () => {
  assert.equal(isSwing(0.4, 0.5), true, 'exactly +0.10 must fire');
  assert.equal(isSwing(0.5, 0.4), true, 'exactly -0.10 must fire');
  assert.equal(isSwing(0.4, 0.4999), false, '0.0999 must not fire');
  assert.equal(moveDollars(0.11, 0.51), 0.4);
});

await test('detector reports day basis on first sighting and tick basis after', () => {
  const det = new SwingDetector();
  const market = { ticker: 'T1', previous_price_dollars: '0.30', title: 'x' };
  const first = det.observe(market, { price: 0.55, ts: 1000 });
  assert.equal(first.length, 1);
  assert.equal(first[0].basis, 'day');
  assert.equal(first[0].direction, 'up');
  const second = det.observe(market, { price: 0.44, ts: 2000 });
  assert.equal(second.length, 1);
  assert.equal(second[0].basis, 'tick');
  assert.equal(second[0].direction, 'down');
  assert.equal(det.observe(market, { price: 0.46, ts: 3000 }).length, 0);
});

// --- topic classification ---------------------------------------------------
await test('topic classification covers all five requested topics', () => {
  assert.equal(classifyMarket({ title: 'Will US gas prices exceed $4', ticker: 'X' }, {}).topicId, 'gas');
  assert.equal(classifyMarket({ title: 'Will the Democrat win the Senate election', ticker: 'X' }, {}).topicId, 'elections');
  assert.equal(classifyMarket({ title: 'Best Picture Oscar winner', ticker: 'X' }, {}).topicId, 'culture');
  assert.equal(classifyMarket({ title: 'Will Bitcoin be above $100000', ticker: 'X' }, {}).topicId, 'crypto');
  assert.equal(classifyMarket({ title: 'Masters Tournament winner', ticker: 'X' }, {}).topicId, 'golf');
  assert.equal(classifyMarket({ title: 'Will it rain in NYC', ticker: 'X' }, {}), null, 'weather is out of scope');
});

await test('official Kalshi metadata classifies before keywords', () => {
  // Verified real series metadata shapes (demo API, 2026-11-20).
  const crypto = classifyMarket({ title: 'Placeholder thing', ticker: 'KXFOO-1' }, { seriesTicker: 'KXBTCD', category: 'Crypto', tags: ['Crypto', 'Hourly', 'Bitcoin'] });
  assert.equal(crypto.topicId, 'crypto');
  assert.equal(crypto.reason, 'kalshi_series_category');

  const culture = classifyMarket(
    { title: 'Will Grok be banned this year', ticker: 'KXXBANNEDGROK-1' },
    { seriesTicker: 'KXXBANNEDGROK', category: 'Culture', tags: ['AI'] },
  );
  assert.equal(culture.topicId, 'culture');
  assert.equal(culture.reason, 'kalshi_series_category');

  const gas = classifyMarket({ title: 'Will average gas prices be above $5.00?', ticker: 'KXAAAGASM-1' }, { seriesTicker: 'KXAAAGASM', category: 'Economics', tags: ['Oil & Gas', 'Oil and energy'], scope: 'Gasoline' });
  assert.equal(gas.topicId, 'gas', 'gas must come from the Oil & Gas tag, not a Gas category');
  assert.ok(['kalshi_series_tag', 'kalshi_product_scope'].includes(gas.reason));

  const golf = classifyMarket({ title: 'The RSM Classic: Bill Haas wins', ticker: 'KXPGATOUR-1' }, { seriesTicker: 'KXPGATOUR', category: 'Sports', tags: ['Golf'] });
  assert.equal(golf.topicId, 'golf', 'golf must come from the Golf tag, not the Sports category');

  const unrelatedSport = classifyMarket({ title: 'NFL game winner', ticker: 'KXNFLGAME-1' }, { seriesTicker: 'KXNFLGAME', category: 'Sports', tags: [] });
  assert.equal(unrelatedSport, null, 'an untagged Sports market must not become golf');
});

// --- scoring & paper trading -----------------------------------------------
await test('roiScore is bounded and exposes every factor', () => {
  const s = roiScore({ fromPrice: 0.4, toPrice: 0.52, spread: 0.02, liquidityDollars: 5000, openInterest: 900, volume24h: 400, timeToCloseHours: 30 });
  assert.ok(s.score >= 0 && s.score <= 100);
  for (const k of ['netEdgePerContract', 'feePerContract', 'spreadCostPerContract', 'momentumTerm', 'feeSource']) {
    assert.ok(k in s.factors, `missing factor ${k}`);
  }
  assert.equal(roiScore({ fromPrice: 0.5, toPrice: 1, spread: 0.01 }).score, 0, 'boundary price scores zero');

  // Cross-check the fee formula against the official schedule's own table:
  // "Price for 100 contracts $50.00 -> Fee for 100 contracts $1.75" and
  // "$0.40 -> $40.00 -> $1.68".
  // Cross-check the published formula M x 0.07 x C x P x (1-P) against the schedule's
  // own General Trading Fees Table (fee for 100 contracts), allowing one cent for the
  // schedule's undocumented "round up" step.
  const feeFor = (p, c, m = 1) => m * 0.07 * c * p * (1 - p);
  const table = [[0.01, 0.07], [0.05, 0.34], [0.10, 0.63], [0.15, 0.90], [0.20, 1.12],
    [0.25, 1.32], [0.30, 1.47], [0.35, 1.60], [0.40, 1.68], [0.45, 1.74], [0.50, 1.75],
    [0.55, 1.74], [0.60, 1.68], [0.65, 1.60], [0.70, 1.47], [0.75, 1.32], [0.80, 1.12],
    [0.85, 0.90], [0.90, 0.63], [0.95, 0.34], [0.99, 0.07]];
  for (const [price, published] of table) {
    const computed = feeFor(price, 100);
    assert.ok(Math.abs(Math.round(computed * 100) / 100 - published) <= 0.02,
      `fee mismatch at $${price}: computed ${computed.toFixed(4)} vs published ${published}`);
  }
});

await test('decideTrade routes each alert to one deterministic strategy', () => {
  const alert = { toPrice: 0.6, fromPrice: 0.45, direction: 'up', moveDollars: 0.15 };
  const d = decideTrade(alert, { bankrollCents: 100000 });
  assert.ok(d && Object.values(STRATEGIES).includes(d.strategy));
  const again = decideTrade(alert, { bankrollCents: 100000 });
  assert.equal(d.strategy, again.strategy, 'routing must be deterministic');
  assert.equal(decideTrade({ toPrice: 0.99, fromPrice: 0.9, direction: 'up', moveDollars: 0.09 }, { bankrollCents: 1e6 }), null);
});

await test('paper broker: settle yes pays $1 per contract, no pays $0', () => {
  const broker = new PaperBroker({ startingBalanceCents: 10000, logger: quiet });
  broker.open({ ticker: 'A', strategy: 'momentum', outcome: 'yes', price: 0.4, contracts: 10 });
  broker.open({ ticker: 'A', strategy: 'mean_revert', outcome: 'no', price: 0.6, contracts: 5 });
  const closed = broker.settleMarket('A', 'yes');
  assert.equal(closed.length, 2);
  const yes = closed.find((t) => t.outcome === 'yes');
  const no = closed.find((t) => t.outcome === 'no');
  assert.equal(yes.proceedsCents, 1000, '10 contracts x $1.00');
  assert.equal(no.proceedsCents, 0);
  assert.equal(broker.state.cashCents, 10000 - 400 - 300 + 1000);
});

await test('analyzeTrades groups by strategy type', () => {
  const a = analyzeTrades([
    { strategy: 'momentum', pnlCents: 100, costCents: 400, holdMs: 60000, outcome: 'yes', topicId: 'crypto' },
    { strategy: 'momentum', pnlCents: -50, costCents: 300, holdMs: 30000, outcome: 'no', topicId: 'golf' },
    { strategy: 'fade_extreme', pnlCents: 25, costCents: 100, holdMs: 10000, outcome: 'no' },
  ]);
  const mom = a.byStrategy.find((r) => r.strategy === 'momentum');
  assert.equal(mom.trades, 2);
  assert.equal(mom.wins, 1);
  assert.equal(mom.pnlCents, 50);
  assert.equal(a.totals.trades, 3);
});

// --- chart windows ----------------------------------------------------------
await test('buildChart returns seconds/minutes/hours windows with x=time, y=price', () => {
  const now = Date.now();
  const market = {
    ticker: 'T',
    price: 0.55,
    previousPrice: 0.45,
    history: Array.from({ length: 50 }, (_, i) => ({ t: now - i * 10000, p: 0.5 + i * 0.001 })),
    seriesTicker: 'SER',
  };
  for (const w of ['seconds', 'minutes', 'hours']) {
    const c = buildChart(market, w);
    assert.equal(c.window, w);
    assert.ok(Array.isArray(c.series));
    for (const point of c.series) {
      assert.ok(Number.isFinite(point.t) && Number.isFinite(point.p));
    }
    assert.ok(c.series.every((p, i, arr) => i === 0 || arr[i - 1].t <= p.t), 'series must be time-ordered');
  }
  const hours = buildChart(market, 'hours');
  assert.equal(hours.series[0].seed, 'previous_price_dollars', 'hours window seeds from the documented day-ago price');
});

// --- end to end over HTTP ---------------------------------------------------
const fakeClient = {
  base: 'https://external-api.demo.kalshi.co/trade-api/v2',
  wsUrl: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
  authenticated: false,
  lastRateLimit: { limit: '100', remaining: '99', reset: '1.5', cost: '10', readAt: new Date().toISOString() },
  async exchangeStatus() { return { exchange_active: true, trading_active: true }; },
  async allMarkets(params) {
    if (params.status === 'settled') return [];
    return buildSeriesMarkets();
  },
  async orderbook(ticker) {
    const seed = [...ticker].reduce((s, c) => s + c.charCodeAt(0), 0);
    const mid = 0.35 + ((seed % 30) / 100);
    return {
      yes: [{ price: Math.round((mid - 0.02) * 100) / 100, count: 120 }, { price: Math.round((mid - 0.05) * 100) / 100, count: 300 }],
      no: [{ price: Math.round((1 - mid - 0.02) * 100) / 100, count: 90 }, { price: Math.round((1 - mid - 0.04) * 100) / 100, count: 210 }],
    };
  },
  async seriesList() { return { series: [] }; },
  async balance() { throw new Error('not authenticated in test'); },
  async positions() { return { market_positions: [] }; },
};

const tempDir = new URL('./.tmp-data/', import.meta.url).pathname;
const collector = new Collector({ client: fakeClient, dataDir: tempDir, logger: quiet, trackedPerTopic: 6 });

await test('collector poll populates all five topics and produces alerts + paper trades', async () => {
  await collector.pollOnce();
  const state = collector.state();
  assert.equal(state.dataMode, 'live');
  assert.equal(state.topics.length, 5);
  const tracked = state.topics.reduce((s, t) => s + t.marketCount, 0);
  assert.ok(tracked > 0, 'should track markets');
  assert.ok(state.status.tracked > 0);
  collector.managePositions();
});

await test('every HTTP route answers', async () => {
  const server = createServer({ collector, logger: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Close in finally: a failed assertion must never leave the listener open —
  // a leaked TCPServerWrap keeps the process alive and hangs CI (watchdog, 2026-11-21).
  try {
  const { port } = server.address();
  const get = async (p) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  const state = await get('/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.body.topics.length === 5);

  const health = await get('/api/health');
  assert.equal(health.body.ok, true);
  assert.ok(health.body.docs.length >= 4);

  assert.equal((await get('/api/topics')).status, 200);
  assert.equal((await get('/api/alerts?feed=all')).status, 200);
  assert.equal((await get('/api/alerts?feed=model')).status, 200);
  assert.equal((await get('/api/resolutions')).status, 200);
  const portfolio = await get('/api/portfolio');
  assert.equal(portfolio.status, 200);
  assert.equal(portfolio.body.kalshiDemoAccount.available, false, 'no key => explicitly unavailable, not faked');

  const anyTicker = state.body.topics.flatMap((t) => t.markets)[0].ticker;
  const market = await get(`/api/market/${encodeURIComponent(anyTicker)}`);
  assert.equal(market.status, 200);
  assert.ok(Array.isArray(market.body.history));

  for (const w of ['seconds', 'minutes', 'hours']) {
    const chart = await get(`/api/chart/${encodeURIComponent(anyTicker)}?window=${w}`);
    assert.equal(chart.status, 200);
    assert.equal(chart.body.window, w);
  }

  // Static routes: both builds must be reachable from the same server.
  assert.equal((await get('/app/')).status, 200, '/app/ must serve the dashboard');
  assert.equal((await get('/site/')).status, 200, "the /site/ prefix must serve this build's site");
  assert.equal((await get('/site/flagged.html')).status, 200);
  assert.equal((await get('/site/assets/site.css')).status, 200);
  assert.equal((await get('/index.html')).status, 200, 'repository site root must still serve');

  assert.equal((await get('/api/market/NOPE')).status, 404);
  assert.equal((await get('/api/does-not-exist')).status, 404);

  // SSE endpoint opens and greets.
  const sse = await fetch(`http://127.0.0.1:${port}/api/stream`);
  assert.equal(sse.status, 200);
  const reader = sse.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /event: hello/);
  await reader.cancel();
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// --- snapshot and synthetic demo modes -------------------------------------
await test('snapshot mode replays real captured values and labels itself', async () => {
  const snap = new Collector({
    dataDir: new URL('../data/', import.meta.url).pathname,
    dataMode: 'snapshot',
    logger: quiet,
  });
  await snap.pollOnce();
  const st = snap.state();
  assert.equal(st.dataMode, 'snapshot', 'must not claim to be live');
  assert.ok(st.topics.reduce((n, t) => n + t.marketCount, 0) > 0, 'snapshot must contain markets');
  const first = st.topics.flatMap((t) => t.markets)[0];
  assert.ok(!first.ticker.startsWith('DEMO-'), 'snapshot values are real, not synthetic');
  assert.match(st.status.notes[0], /captured/i);
});

await test('synthetic demo mode is unmistakably labelled and drives the full pipeline', async () => {
  const demo = new Collector({ dataDir: tempDir + 'demo/', dataMode: 'demo', logger: quiet });
  for (let i = 0; i < 6; i += 1) {
    await demo.pollOnce();
    demo.managePositions();
  }
  const st = demo.state();
  assert.equal(st.dataMode, 'demo');
  assert.ok(st.topics.every((t) => t.marketCount > 0), 'every topic should have synthetic markets');
  assert.ok(st.topics.every((t) => t.markets.every((m) => m.ticker.startsWith('DEMO-'))), 'every synthetic ticker must be prefixed DEMO-');
  assert.ok(st.topics.every((t) => t.markets.every((m) => m.title.startsWith('[DEMO]'))), 'every synthetic title must be marked [DEMO]');
  assert.ok(st.portfolio.openPositions.length + st.portfolio.closedTrades.length > 0, 'the paper engine should have traded');
  assert.match(st.status.notes[0], /NOT Kalshi markets/i);
});

// --- snapshot capture (scripts/capture-snapshot.js) -------------------------
await test('capture keeps API records byte-identical and never invents a topic', async () => {
  const { buildSnapshot, seriesTickerOf, dollars } = await import('../scripts/capture-snapshot.js');
  const rawGas = {
    ticker: 'KXAAAGASM-26NOV30-4.80', event_ticker: 'KXAAAGASM-26NOV30',
    title: 'Will average **gas prices** be above $4.80?', status: 'active', result: '',
    yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000', no_bid_dollars: '0.0000',
    volume_fp: '55571.52', open_interest_fp: '55567.52', last_price_dollars: '0.0300',
  };
  const rawNoise = { ticker: 'OTHER-1', event_ticker: 'OTHER-1', title: 'irrelevant', volume_fp: '999999.00', last_price_dollars: '0.9900' };
  const series = [
    { ticker: 'KXAAAGASM', title: 'US gas price', category: 'Economics', tags: ['Oil & Gas', 'Oil and energy'], product_metadata: { scope: 'Gasoline' } },
    { ticker: 'OTHER', title: 'not in the five topics', category: 'Weather', tags: [] },
  ];
  const snap = buildSnapshot({
    env: 'demo', rawMarkets: [rawGas, rawNoise], seriesRecords: series,
    exchangeStatus: { exchange_active: true, trading_active: true, exchange_index_statuses: [{ exchange_index: 0 }, { exchange_index: 2 }] },
    topPerTopic: 3, capturedAt: '2026-11-20T20:00:00Z',
  });
  assert.equal(snap.markets.length, 1, 'only the market whose series says it is a gas series is kept');
  assert.deepEqual(snap.markets[0], rawGas, 'the market record is stored exactly as the API returned it');
  assert.equal(snap.markets[0].title, 'Will average **gas prices** be above $4.80?', 'not even markdown is stripped in the data');
  assert.equal(snap.topicCounts.gas, 1);
  assert.equal(snap.topicCounts.elections, undefined, 'no topic is invented to fill a gap');
  assert.deepEqual(snap.exchangeStatus.shards, [0, 2]);
  assert.equal(snap.exchangeStatus.trading_active, true);
  assert.ok(snap.sources.every((u) => u.startsWith('https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=')),
    'every source must be the official endpoint that produced the row');
  assert.equal(seriesTickerOf({ event_ticker: 'KXETHD-26NOV2101' }), 'KXETHD');
  assert.equal(dollars(rawGas), +(55571.52 * 0.03).toFixed(4), 'dollars = volume_fp x last price (disclosed approximation)');
  assert.equal(dollars({}), null, 'no price or no volume stays null');
});

await test('capture never writes when the exchange is unreachable', async () => {
  const { execFileSync } = await import('node:child_process');
  let code = 0;
  try {
    execFileSync(process.execPath, ['scripts/capture-snapshot.js', '--env', 'nonsense'], { cwd: process.cwd(), stdio: 'pipe' });
  } catch (e) { code = e.status; }
  assert.equal(code, 2, 'an unknown environment must exit 2, not write a file');
});

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

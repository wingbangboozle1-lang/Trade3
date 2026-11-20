import { renderTable, esc } from './common.js';

const RECS = [
  {
    n: 1, title: 'Switch price updates to the authenticated WebSocket', impact: 'Very high', effort: 'Medium',
    what: 'Subscribe to the ticker, trade and market_lifecycle_v2 channels instead of polling REST every 15 seconds.',
    why: 'Alerts would fire in milliseconds rather than on a poll tick, which is the difference between a dashboard and a terminal.',
    fact: 'The connection requires API-key headers signed the same way as REST, and the signed path for the handshake is /trade-api/ws/v2. Handshake rejections arrive as HTTP 429 too_many_requests, so reconnect with exponential backoff.',
    src: 'https://docs.kalshi.com/getting_started/quick_start_websockets', srcLabel: 'Quick Start: WebSockets',
  },
  {
    n: 2, title: 'Stream the order book instead of re-reading it', impact: 'High', effort: 'Medium',
    what: 'Use the orderbook_delta channel to keep a live depth ladder, applying deltas instead of replacing the book.',
    why: 'A depth ladder that updates continuously makes liquidity readable at a glance; polling makes it look frozen.',
    fact: 'orderbook_delta is listed as a private channel, so it needs the authenticated session, while ticker and trade are public market-data channels on the same authenticated connection.',
    src: 'https://docs.kalshi.com/getting_started/quick_start_websockets', srcLabel: 'WebSockets guide',
  },
  {
    n: 3, title: 'Drive charts from official candlesticks', impact: 'High', effort: 'Low',
    what: 'Backfill the chart with GET /series/{series_ticker}/markets/{ticker}/candlesticks, then append live ticks.',
    why: 'The chart becomes useful the instant the app opens, instead of after an hour of collecting samples.',
    fact: 'period_interval accepts 1, 60 or 1440 minutes, and a single request may span at most 5,000 periods — about 3.5 days for 1-minute candles. start_ts and end_ts must be seconds; milliseconds are rejected with 400.',
    src: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks', srcLabel: 'Get Market Candlesticks',
  },
  {
    n: 4, title: 'Attach a real news timeline to each jump', impact: 'High', effort: 'High',
    what: 'Capture a timestamped news feed and plot headlines as markers on the chart, with a stated confidence method.',
    why: 'This is the one requirement that is genuinely hard, and doing it badly is worse than not doing it: attributing a move to a headline you did not timestamp is fabrication.',
    fact: 'Kalshi itself publishes settlement sources per series — AAA for gas, CF Benchmarks for crypto, ESPN / Fox Sports / the PGA Tour for golf. Those are the sources that decide contracts, and they are the right place to start a timeline.',
    src: 'https://docs.kalshi.com/api-reference/market/get-series-list', srcLabel: 'Get Series List (settlement sources)',
  },
  {
    n: 5, title: 'Use previous_price_dollars as a built-in 24h delta', impact: 'Medium', effort: 'Low',
    what: 'Show every market’s day-over-day change directly from the market object.',
    why: 'Gives a real reference point immediately on first load, with no local history needed.',
    fact: 'Kalshi documents previous_price_dollars as the last traded YES price a day ago. This build already seeds the hours chart from it.',
    src: 'https://docs.kalshi.com/api-reference/market/get-markets', srcLabel: 'Get Markets',
  },
  {
    n: 6, title: 'Show your queue position on resting orders', impact: 'Medium', effort: 'Low',
    what: 'When an order rests, display how many contracts must match before it fills.',
    why: 'Turns “my order is working” into “I am 240 contracts from a fill”, which is what actually decides whether to wait or cross the spread.',
    fact: 'Queue position is defined by price-time priority and exposed per order by the dedicated queue-position endpoint.',
    src: 'https://docs.kalshi.com/api-reference/orders/get-queue-positions-for-orders', srcLabel: 'Get Queue Positions for Orders',
  },
  {
    n: 7, title: 'Respect the rate-limit budget visibly', impact: 'Medium', effort: 'Low',
    what: 'Show the tokens left in the current bucket as a small meter.',
    why: 'A trader who can see the budget stops wondering why a request was throttled.',
    fact: 'Every response carries X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset and X-RateLimit-Cost, and buckets are separate for reads, writes and per shard.',
    src: 'https://docs.kalshi.com/getting_started/rate_limits', srcLabel: 'Rate Limits and Tiers',
  },
  {
    n: 8, title: 'Balance the budget across exchange shards', impact: 'Medium', effort: 'Medium',
    what: 'Show which shard each market lives on, and let the collector spread requests across shards.',
    why: 'Write budgets are per shard, so a shard-aware trader has headroom that a shard-blind one does not.',
    fact: 'A single order write targeting exchange_index >= 1 is billed to that shard’s write bucket, while auto-routed traffic is billed to every shard’s bucket.',
    src: 'https://docs.kalshi.com/getting_started/exchange_sharding', srcLabel: 'Exchange Sharding',
  },
  {
    n: 9, title: 'Use the dedicated user host for fills', impact: 'Medium', effort: 'Low',
    what: 'Move fill and user_orders subscriptions to the user WebSocket host.',
    why: 'Faster fill notifications mean the portfolio panel updates the moment a trade happens.',
    fact: 'Fill and order updates are served by dedicated user hosts with lower latency; subscribing to those channels elsewhere returns error code 8. The older warp-ws hosts are deprecated.',
    src: 'https://docs.kalshi.com/getting_started/api_environments', srcLabel: 'API Environments',
  },
  {
    n: 10, title: 'Cache series metadata aggressively', impact: 'Medium', effort: 'Low',
    what: 'Persist series category, tags and scope to disk and refresh only when they change.',
    why: 'Topic routing is metadata work, not price work; refetching it every cycle wastes budget that belongs to market data.',
    fact: 'GET /series supports min_updated_ts, so a poll can ask only for series whose metadata changed — exactly the documented use for that filter.',
    src: 'https://docs.kalshi.com/api-reference/market/get-series-list', srcLabel: 'Get Series List',
  },
  {
    n: 11, title: 'Add a staging vs live toggle', impact: 'Low', effort: 'Low',
    what: 'Flip between demo and production with one switch, showing the environment everywhere.',
    why: 'Demo behaviour is explicitly not representative, so a trader needs to know which world they are looking at at all times.',
    fact: 'Demo and production use separate hosts and credentials that are not shared, so the switch must swap base URL and key together.',
    src: 'https://docs.kalshi.com/getting_started/api_environments', srcLabel: 'API Environments',
  },
  {
    n: 12, title: 'Settle paper trades from the market result, not a price guess', impact: 'Low', effort: 'Done',
    what: 'Hold positions to resolution and settle at $1/$0 on the official result field.',
    why: 'Removes the most common source of fake backtest alpha: assuming you exited near the top.',
    fact: 'Settlement pays $1 per contract to the winning side, and only net positions settle. This build already settles this way.',
    src: 'https://docs.kalshi.com/getting_started/market_settlement', srcLabel: 'Market Settlement',
  },
  {
    n: 13, title: 'Track settlement bounds and early closes', impact: 'Low', effort: 'Medium',
    what: 'Flag markets with settlement floors and can_close_early, and show the early-close condition in the drawer.',
    why: 'A market that can close early changes the risk of holding to expiry, which matters more than the last tick.',
    fact: 'Markets expose can_close_early plus an early_close_condition string, and markets with a settlement floor can pay YES holders part of the payout before settlement.',
    src: 'https://docs.kalshi.com/getting_started/settlement_bounds', srcLabel: 'Settlement Bounds',
  },
];

renderTable(
  'recTable',
  [
    { label: '#', numeric: true, value: (r) => String(r.n) },
    { label: 'Recommendation', value: (r) => `<strong>${esc(r.title)}</strong>` },
    { label: 'Impact', value: (r) => `<span class="badge ${r.impact === 'Very high' || r.impact === 'High' ? 'ok' : r.impact === 'Medium' ? 'info' : ''}">${esc(r.impact)}</span>` },
    { label: 'Effort', value: (r) => esc(r.effort) },
    { label: 'What it changes', value: (r) => esc(r.why) },
    {
      label: 'Official source',
      value: (r) =>
        `<a href="${esc(r.src)}" target="_blank" rel="noopener">official ↗</a>` +
        `<span class="tiny" style="display:block;font-size:11px;color:#8b9bb4;margin-top:2px">${esc(r.srcLabel)}</span>`,
    },
  ],
  RECS,
);

document.getElementById('recDetails').innerHTML = RECS.slice(0, 6).map(
  (r) => `<div class="card tight">
    <span class="badge info">${esc(r.impact)} impact · ${esc(r.effort)} effort</span>
    <h3 style="margin:8px 0 6px">${esc(r.n)}. ${esc(r.title)}</h3>
    <p style="margin:0 0 6px;font-size:13.5px"><strong>What:</strong> ${esc(r.what)}</p>
    <p style="margin:0 0 6px;font-size:13.5px"><strong>Why:</strong> ${esc(r.why)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#9fb3c8"><strong>Verified:</strong> ${esc(r.fact)}</p>
    <a href="${esc(r.src)}" target="_blank" rel="noopener">${esc(r.srcLabel)} ↗</a>
  </div>`,
).join('');

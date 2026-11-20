import { SOURCES, DEMO_REST, DEMO_WS } from '../data.js';
import { renderTable } from './common.js';

const docs = [
  { what: 'Demo environment and its caveats', url: SOURCES.demoEnv.url },
  { what: 'REST and WebSocket base URLs, production and demo', url: SOURCES.envs.url },
  { what: 'API keys, signing rules and the 30-second timestamp window', url: SOURCES.apiKeys.url },
  { what: 'Token budgets, buckets and rate-limit headers', url: SOURCES.rateLimits.url },
  { what: 'Order-book structure and why only bids are returned', url: SOURCES.orderbook.url },
  { what: 'Get Markets: fields, filters and pagination', url: SOURCES.markets.url },
  { what: 'Get Trades: fields, limit and timestamp units', url: SOURCES.trades.url },
  { what: 'Candlesticks: periods, limits and units', url: SOURCES.candles.url },
  { what: 'Get Series List: category and tag matching', url: SOURCES.seriesList.url },
  { what: 'Create Order (V2) and the removal of the legacy endpoints', url: SOURCES.createOrder.url },
  { what: 'Get Positions: settlement status and count filters', url: SOURCES.positions.url },
  { what: 'Get Balance: cents, and its own rate-limit bucket', url: SOURCES.balance.url },
  { what: 'Market Settlement: $1 per winning contract', url: SOURCES.settlement.url },
  { what: 'WebSocket handshake, signing and channels', url: SOURCES.ws.url },
  { what: 'Fee schedule: the published fee formula', url: SOURCES.feeSchedule.url },
];

renderTable(
  'docSources',
  [
    { label: 'What it establishes', value: (r) => r.what },
    {
      label: 'URL',
      value: (r) =>
        `<a href="${r.url}" target="_blank" rel="noopener" class="url">official ↗</a>` +
        `<span class="tiny" style="display:block;font-size:11px;color:#8b9bb4;overflow-wrap:anywhere">${r.url}</span>`,
    },
  ],
  docs,
);

const api = [
  { what: 'Exchange status (demo)', url: SOURCES.exchangeStatus.url },
  { what: 'Open markets (demo)', url: `${DEMO_REST}/markets?status=open` },
  { what: 'Settled markets (demo)', url: `${DEMO_REST}/markets?status=settled&limit=100` },
  { what: 'Series list by category — Crypto', url: `${DEMO_REST}/series?category=Crypto` },
  { what: 'Series list by category — Elections', url: `${DEMO_REST}/series?category=Elections` },
  { what: 'Series list by category — Culture', url: `${DEMO_REST}/series?category=Culture` },
  { what: 'Series list by category — Golf (returns null)', url: `${DEMO_REST}/series?category=Golf` },
  { what: 'Series list by category — Gas (returns null)', url: `${DEMO_REST}/series?category=Gas` },
  { what: 'Gas series metadata (KXAAAGASM)', url: `${DEMO_REST}/series/KXAAAGASM` },
  { what: 'Golf series metadata (KXPGATOUR)', url: `${DEMO_REST}/series/KXPGATOUR` },
  { what: 'Crypto series metadata (KXBTCD)', url: `${DEMO_REST}/series/KXBTCD` },
  { what: 'Elections series metadata (GOVPARTYVA)', url: `${DEMO_REST}/series/GOVPARTYVA` },
  { what: 'Open gas markets', url: `${DEMO_REST}/markets?series_ticker=KXAAAGASM&status=open` },
  { what: 'Open golf markets', url: `${DEMO_REST}/markets?series_ticker=KXPGATOUR&status=open` },
  { what: 'Open Bitcoin ladder markets', url: `${DEMO_REST}/markets?series_ticker=KXBTCD&status=open` },
  { what: 'NATO Secretary General event markets', url: `${DEMO_REST}/markets?event_ticker=KXNEXTNATOSECGEN-99` },
  { what: 'WebSocket endpoint (demo)', url: DEMO_WS.replace('wss://', 'https://') },
];

renderTable(
  'apiSources',
  [
    { label: 'Call', value: (r) => r.what },
    {
      label: 'URL',
      value: (r) =>
        `<a href="${r.url}" target="_blank" rel="noopener" class="url">official ↗</a>` +
        `<span class="tiny" style="display:block;font-size:11px;color:#8b9bb4;overflow-wrap:anywhere">${r.url}</span>`,
    },
  ],
  api,
);

renderTable(
  'thirdPartySources',
  [
    { label: 'Source', value: (r) => `<strong>${r.what}</strong>` },
    { label: 'Used for', value: (r) => r.why },
    {
      label: 'URL',
      value: (r) =>
        `<a href="${r.url}" target="_blank" rel="noopener" class="url">official ↗</a>` +
        `<span class="tiny" style="display:block;font-size:11px;color:#8b9bb4;overflow-wrap:anywhere">${r.url}</span>`,
    },
  ],
  [
    { what: 'AAA Gas Prices', why: 'The settlement source Kalshi names for the US gas price series.', url: 'https://gasprices.aaa.com/' },
    { what: 'CF Benchmarks BRTI', why: 'The settlement source Kalshi names for Bitcoin threshold markets.', url: 'https://www.cfbenchmarks.com/data/indices/BRTI' },
    { what: 'PGA Tour', why: 'One of the governing-league sources Kalshi names for PGA Tour markets.', url: 'https://www.pgatour.com/' },
    { what: 'Kalshi demo UI', why: 'Where a human creates demo API keys and can see the demo portfolio.', url: 'https://demo.kalshi.co/' },
  ],
);

import { REQUIREMENTS } from '../data.js';
import { renderTable, esc, kpis, statusBadge } from './common.js';

const counts = {
  total: REQUIREMENTS.length,
  delivered: REQUIREMENTS.filter((r) => r.status === 'Delivered').length,
  partial: REQUIREMENTS.filter((r) => r.status.startsWith('Partially')).length,
  keyed: REQUIREMENTS.filter((r) => r.status.includes('needs an API key') || r.status.includes('disabled')).length,
};

kpis('reqKpis', [
  ['Requirements', String(counts.total), 'from the brief'],
  ['Fully delivered', String(counts.delivered), 'no caveats'],
  ['Needs config or opt-in', String(counts.keyed), 'API key or explicit enable'],
  ['Partially delivered', String(counts.partial), 'gap published'],
]);

renderTable(
  'reqTable',
  [
    { label: 'ID', value: (r) => `<code>${esc(r.id)}</code>` },
    { label: 'Requirement', value: (r) => `<strong>${esc(r.requirement)}</strong>` },
    { label: 'Where it lives', value: (r) => `<span class="mono" style="font-size:11.5px">${esc(r.where)}</span>` },
    { label: 'Status', value: (r) => statusBadge(r.status) },
    { label: 'Evidence', value: (r) => esc(r.evidence) },
    { label: 'Official source', value: (r) => `<a href="${esc(r.source)}" target="_blank" rel="noopener">docs ↗</a>` },
  ],
  REQUIREMENTS,
);

renderTable(
  'testTable',
  [
    { label: '#', numeric: true, value: (r) => String(r.n) },
    { label: 'Check', value: (r) => `<strong>${esc(r.name)}</strong>` },
    { label: 'Why it exists', value: (r) => esc(r.why) },
    {
      label: 'Official basis',
      value: (r) =>
        `<a href="${esc(r.src)}" target="_blank" rel="noopener">official ↗</a>`,
    },
  ],
  [
    { n: 1, name: 'Inclusive $0.10 threshold', why: 'Exactly +0.10 and exactly −0.10 must fire; 0.0999 must not.', src: 'https://docs.kalshi.com/api-reference/market/get-markets' },
    { n: 2, name: 'Detector bases', why: 'Day basis fires once on first sighting; tick basis fires on the next move; a small move fires nothing.', src: 'https://docs.kalshi.com/api-reference/market/get-markets' },
    { n: 3, name: 'Five-topic routing', why: 'Each of the five topics routes correctly, and an out-of-scope market is dropped rather than forced.', src: 'https://docs.kalshi.com/api-reference/market/get-series-list' },
    { n: 4, name: 'Official metadata precedence', why: 'Gas routes on the Oil & Gas tag, golf on the Golf tag, and an untagged Sports market never becomes golf.', src: 'https://docs.kalshi.com/api-reference/market/get-series-list' },
    { n: 5, name: 'Score bounds and factors', why: 'Score stays 0–100, every factor is exposed, and the fee formula is checked against all 21 published rows.', src: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
    { n: 6, name: 'Strategy routing', why: 'The same alert always routes to the same strategy, and boundary prices are skipped.', src: 'https://docs.kalshi.com/getting_started/orderbook_responses' },
    { n: 7, name: 'Settlement arithmetic', why: 'A winning YES position pays exactly $1 per contract; a losing NO position pays nothing.', src: 'https://docs.kalshi.com/getting_started/market_settlement' },
    { n: 8, name: 'Per-strategy analytics', why: 'Trades group by strategy with correct win/loss counts and P&L sums.', src: 'https://docs.kalshi.com/api-reference/portfolio/get-positions' },
    { n: 9, name: 'Chart windows', why: 'All three windows return time-ordered points, and the hours window seeds from the documented day-ago price.', src: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks' },
    { n: 10, name: 'Collector pipeline', why: 'A poll populates all five topics and the paper engine only trades scored alerts.', src: 'https://docs.kalshi.com/getting_started/rate_limits' },
    { n: 11, name: 'Every HTTP route', why: 'All API routes answer, unknown tickers 404, and the SSE stream greets on connect.', src: 'https://docs.kalshi.com/getting_started/api_environments' },
  ],
);

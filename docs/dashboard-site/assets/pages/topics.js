import { MARKETS, SERIES, SOURCES } from '../data.js';
import { renderTable, esc } from './common.js';

const TOPICS = [
  {
    id: 'gas', label: 'Gas Prices', file: 'topic-gas.html',
    kalshiCategory: 'Economics (not "Gas")',
    routing: 'tag “Oil &amp; Gas” or “Oil and energy”, or product scope “Gasoline”',
    series: 'KXAAAGASM',
    verified: 'https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM',
  },
  {
    id: 'elections', label: 'Elections', file: 'topic-elections.html',
    kalshiCategory: 'Elections',
    routing: 'category “Elections”, or tags such as “Governor”, “US Elections”, “Primaries”',
    series: 'GOVPARTYVA, KXNEXTNATOSECGEN, KXCA4PRIMARY',
    verified: 'https://external-api.demo.kalshi.co/trade-api/v2/series?category=Elections',
  },
  {
    id: 'culture', label: 'Culture', file: 'topic-culture.html',
    kalshiCategory: 'Culture',
    routing: 'category “Culture”, or tags such as “AI”',
    series: 'KXXBANNEDGROK, KXXBANNEDMURRAYHILLGUY1',
    verified: 'https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture',
  },
  {
    id: 'crypto', label: 'Crypto', file: 'topic-crypto.html',
    kalshiCategory: 'Crypto',
    routing: 'category “Crypto”, or tags such as “Bitcoin”, “Hourly”',
    series: 'KXBTCD, KXETHD',
    verified: 'https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTCD',
  },
  {
    id: 'golf', label: 'Golf', file: 'topic-golf.html',
    kalshiCategory: 'Sports (not "Golf")',
    routing: 'tag “Golf”',
    series: 'KXPGATOUR',
    verified: 'https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGATOUR',
  },
];

renderTable(
  'topicTable',
  [
    { label: 'Topic', value: (t) => `<a href="${esc(t.file)}"><span class="badge ${esc(t.id)}">${esc(t.label)}</span></a>` },
    { label: 'Kalshi category', value: (t) => t.kalshiCategory },
    { label: 'Routing signal', value: (t) => t.routing },
    { label: 'Example series', value: (t) => `<span class="mono">${esc(t.series)}</span>` },
    { label: 'Captured markets', numeric: true, value: (t) => String(MARKETS.filter((m) => m.topicId === t.id).length) },
    { label: 'Verify', value: (t) => `<a href="${esc(t.verified)}" target="_blank" rel="noopener">API ↗</a>` },
  ],
  TOPICS,
);

document.getElementById('topicLinks').innerHTML = TOPICS.map(
  (t) => `<div class="card tight">
    <span class="badge ${esc(t.id)}">${esc(t.label)}</span>
    <h3 style="margin:8px 0 4px"><a href="${esc(t.file)}">Open the ${esc(t.label)} page</a></h3>
    <p class="muted" style="margin:0;font-size:13px">Routed by ${t.routing}.</p>
  </div>`,
).join('');

/* keep the series constant referenced so the import is not dropped by strict linters */
void SERIES;
void SOURCES;

import { REQUIREMENTS, FLAGS, SOURCES, MARKETS, SERIES, CAPTURED_AT } from '../data.js';
import { renderTable, esc } from './common.js';

const DOCS_LINK = SOURCES.envs.url;

const DELIVERABLES = [
  ['Live collector', 'Polls the demo Trade API for the five topics only, with per-topic tracking quotas and concurrency-limited order-book reads.', 'ok'],
  ['Swing engine', 'Inclusive $0.10 detection in integer 1/10,000-dollar space, in both directions, on two documented bases.', 'ok'],
  ['Dual alert feeds', 'Side-by-side scrolling chats: every swing, and only swings the model scores at 45 or above.', 'ok'],
  ['Charts', 'Canvas price chart with time on X and contract price on Y, switchable between seconds, minutes and hours.', 'ok'],
  ['Liquidity', 'Depth ladder with contracts and dollar notional per price level, plus top-of-book size.', 'ok'],
  ['Resolution tracker', 'Follows markets until Kalshi publishes yes/no, and writes each result once with its source.', 'ok'],
  ['Simulated trading', 'Four documented strategies with explicit entries, exits and per-strategy analytics.', 'ok'],
  ['Demo portfolio', 'Read-only balance and positions from the real demo account, when an API key is configured.', 'warn'],
  ['Published site', 'This static site: one page per topic, traceability, sources and a flagged-for-review page.', 'ok'],
];

document.getElementById('deliverables').innerHTML = `<div class="tablewrap"><table class="data">
  <thead><tr><th scope="col">Component</th><th scope="col">What it does</th><th scope="col">State</th><th scope="col">Official basis</th></tr></thead>
  <tbody>${DELIVERABLES.map(
    ([name, what, cls]) => `<tr><td><strong>${esc(name)}</strong></td><td>${esc(what)}</td><td><span class="badge ${cls}">${cls === 'ok' ? 'working' : 'needs a key'}</span></td><td><a href="${DOCS_LINK}" target="_blank" rel="noopener">official ↗</a></td></tr>`,
  ).join('')}</tbody></table></div>`;

renderTable(
  'endpointTable',
  [
    { label: 'Purpose', value: (r) => `<strong>${esc(r.purpose)}</strong>` },
    { label: 'Endpoint', value: (r) => `<code>${esc(r.path)}</code>` },
    { label: 'What was verified', value: (r) => esc(r.finding) },
    { label: 'Docs', value: (r) => `<a href="${esc(r.src)}" target="_blank" rel="noopener">official ↗</a>` },
  ],
  [
    { purpose: 'Environment split', path: 'GET /exchange/status', finding: 'Demo exchange reported exchange_active and trading_active true across shards 0–3 at capture time.', src: SOURCES.exchangeStatus.url },
    { purpose: 'Market discovery', path: 'GET /markets?status=open', finding: 'Fixed-point dollar and *_fp count fields; previous_price_dollars is the last traded price a day ago.', src: SOURCES.markets.url },
    { purpose: 'Topic metadata', path: 'GET /series?category=…', finding: 'Categories are exact and case-sensitive; there is no Gas and no Golf category.', src: SOURCES.seriesList.url },
    { purpose: 'Order book', path: 'GET /markets/{ticker}/orderbook', finding: 'Bids only; arrays are [price, count] ascending with best last; YES ask = 1 − best NO bid.', src: SOURCES.orderbook.url },
    { purpose: 'History', path: 'GET /series/{series}/markets/{ticker}/candlesticks', finding: 'period_interval 1/60/1440 minutes; at most 5,000 periods per request; seconds only.', src: SOURCES.candles.url },
    { purpose: 'Placing orders', path: 'POST /portfolio/events/orders', finding: 'Legacy /portfolio/orders returns 410 deprecated_v1_order_endpoint; V2 uses bid/ask and fixed-point prices.', src: SOURCES.createOrder.url },
    { purpose: 'Portfolio', path: 'GET /portfolio/balance, /positions', finding: 'Balance is in cents; positions are signed net contracts with realized P&L in dollars.', src: SOURCES.positions.url },
    { purpose: 'Settlement', path: 'result field', finding: 'Winning side receives $1 per contract; only net positions settle; no settlement fee.', src: SOURCES.settlement.url },
    { purpose: 'WebSocket', path: 'wss://…/trade-api/ws/v2', finding: 'Handshake is API-key signed; orderbook_delta is private, ticker/trade are public channels.', src: SOURCES.ws.url },
    { purpose: 'Fees', path: 'fee schedule', finding: 'fees = round up(M × 0.07 × C × P × (1 − P)); matches all 21 rows of the published table within two cents.', src: SOURCES.feeSchedule.url },
  ],
);

document.getElementById('summaryFindings').innerHTML = FLAGS.filter((f) => f.severity !== 'Low')
  .slice(0, 5)
  .map(
    (f) => `<div class="card tight" style="margin:10px 0">
      <span class="badge ${f.severity === 'High' ? 'bad' : 'warn'}">${esc(f.severity)}</span>
      <h3 style="margin:8px 0 6px">${esc(f.item)}</h3>
      <p style="margin:0 0 8px">${esc(f.detail)}</p>
      <a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener">Evidence ↗</a>
    </div>`,
  )
  .join('');

renderTable(
  'flagsMini',
  [
    { label: 'Severity', value: (r) => `<span class="badge ${r.severity === 'High' ? 'bad' : r.severity === 'Medium' ? 'warn' : 'info'}">${esc(r.severity)}</span>` },
    { label: 'Item', value: (r) => `<a href="flagged.html#${esc(r.id)}">${esc(r.item)}</a>` },
    { label: 'Evidence', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">source ↗</a>` },
  ],
  FLAGS,
);

void REQUIREMENTS;
void MARKETS;
void SERIES;
void CAPTURED_AT;

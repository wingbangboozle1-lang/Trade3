import { MARKETS, REQUIREMENTS, FLAGS, SOURCES, CAPTURED_AT, DEMO_REST } from '../data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dash = '<span class="unverified" title="Not returned by the official source">— unverified</span>';
const val = (v) => (v === null || v === undefined || v === '' ? dash : esc(v));

const live = MARKETS.filter((m) => m.topicId !== 'out_of_scope');

/* ---------------- KPIs ---------------- */
const kpis = [
  ['Live markets captured', String(live.length), `across ${new Set(live.map((m) => m.topicId)).size} of 5 topics`],
  ['Topics in scope', '5', 'gas · elections · culture · crypto · golf'],
  ['Swing threshold', '$0.10', 'inclusive, either direction'],
  ['Open flags', String(FLAGS.length), `${FLAGS.filter((f) => f.severity === 'High').length} high severity`],
];
document.getElementById('liveKpis').innerHTML = kpis
  .map(([label, value, sub]) => `<div class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`)
  .join('');

/* ---------------- executive summary ---------------- */
document.getElementById('summaryBody').innerHTML = `
  <p>
    <strong>What was built.</strong> A working dashboard that reads the Kalshi <em>demo</em> Trade API
    (<code>${DEMO_REST}</code>), keeps only markets that belong to gas prices, elections, culture, crypto or golf,
    and then does four things with them: it alerts on any swing of $0.10 or more, it plots price against time at
    three zoom levels, it shows how many contracts are resting at each price, and it follows each market until
    Kalshi publishes a yes/no result. Alongside that, a simulator opens and closes paper trades across four
    documented strategies and reports the results by strategy type.
  </p>
  <p>
    <strong>What makes it trustworthy.</strong> Every value on this site was read from an official Kalshi endpoint
    during the build, and each table row links to the exact URL that produced it. Where Kalshi's documentation
    gives a precise rule, the code follows that rule literally — the order-book maths, the fee formula, the
    settlement payout, and the fact that the legacy order endpoints now return <code>410 Gone</code>. Where
    something could not be confirmed, it is left blank and published on the
    <a href="flagged.html">Flagged for Review</a> page instead of being guessed.
  </p>
  <p>
    <strong>What the data actually shows.</strong> The demo environment is thin. At capture time
    (${esc(CAPTURED_AT)}) many markets were quoted at $0.00 with empty books, and the Culture series had no open
    markets at all. That is a property of the demo, not a bug in the collector, and it is why the dashboard ships
    with an explicit data-mode indicator rather than pretending to be busy.
  </p>
  <p>
    <strong>What is not done.</strong> Two things are deliberately unfinished. Automatic newspaper-style attribution
    of price jumps is not implemented, because attributing a move to a headline without a licensed, timestamped news
    feed would be fabrication. And reading the real demo portfolio needs your own API key; without it the app says
    plainly that it is not connected instead of inventing a balance.
  </p>
  <p class="source-note">
    Sources: <a href="${SOURCES.demoEnv.url}" target="_blank" rel="noopener">demo environment</a> ·
    <a href="${SOURCES.envs.url}" target="_blank" rel="noopener">endpoints</a> ·
    <a href="${SOURCES.orderbook.url}" target="_blank" rel="noopener">order book</a> ·
    <a href="${SOURCES.feeSchedule.url}" target="_blank" rel="noopener">fee schedule</a> ·
    <a href="${SOURCES.settlement.url}" target="_blank" rel="noopener">settlement</a>
  </p>
  <p><a class="btn" href="executive-summary.html">Read the full executive summary →</a></p>`;

/* ---------------- key findings ---------------- */
const FINDINGS = [
  {
    badge: 'bad',
    title: 'Kalshi has no “Gas” or “Golf” category',
    body:
      'Both <code>GET /series?category=Gas</code> and <code>?category=Golf</code> return <code>{"series":null}</code>. Gas lives under ' +
      'category <em>Economics</em> with tags <code>["Oil &amp; Gas"]</code>; golf lives under category <em>Sports</em> with tags ' +
      '<code>["Golf"]</code>. A category-based filter would have produced two empty pages.',
    link: `${DEMO_REST}/series?category=Golf`,
    linkText: 'Verify: category=Golf',
  },
  {
    badge: 'warn',
    title: 'Demo prices are not real prices',
    body:
      'Kalshi states the demo “may not be reflective of those in real markets.” Many captured markets were quoted at $0.00 ' +
      'with empty books, so the alert feed is quiet by design. Production numbers would change the values, not the code.',
    link: SOURCES.demoEnv.url,
    linkText: 'Official caveat',
  },
  {
    badge: 'info',
    title: 'The fee formula is verifiable',
    body:
      'The official schedule gives <code>fees = round up(M × 0.07 × C × P × (1 − P))</code>. Checked against all 21 rows of the ' +
      'schedule’s own table, the formula matches to within two cents. The exact “round up” implementation is the one open question, ' +
      'so fees are labelled computed, not invoiced.',
    link: SOURCES.feeSchedule.url,
    linkText: 'Fee schedule PDF',
  },
  {
    badge: 'warn',
    title: 'Legacy order endpoints are dead',
    body:
      '<code>POST /portfolio/orders</code> and its siblings now return <code>410 deprecated_v1_order_endpoint</code>. Orders must go ' +
      'to <code>POST /portfolio/events/orders</code> with <code>side</code> of <code>bid</code>/<code>ask</code> and fixed-point dollar prices. ' +
      'Older tutorials still show the removed path.',
    link: SOURCES.createOrder.url,
    linkText: 'Create Order (V2)',
  },
];

document.getElementById('keyFindings').innerHTML = FINDINGS.map(
  (f) => `<div class="card tight">
    <span class="badge ${f.badge}">finding</span>
    <h3 style="margin:8px 0 6px">${esc(f.title)}</h3>
    <p style="margin:0 0 8px">${f.body}</p>
    <a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.linkText)} ↗</a>
  </div>`,
).join('');

/* ---------------- market table ---------------- */
const cols = [
  { key: 'topicId', label: 'Topic', value: (r) => `<span class="badge ${esc(r.topicId)}">${esc(r.topic)}</span>` },
  {
    key: 'title',
    label: 'Market',
    value: (r) => `<strong>${esc(r.title)}</strong><span class="tiny mono">${esc(r.ticker)}</span>`,
  },
  { key: 'lastPrice', label: 'Last', numeric: true, value: (r) => val(r.lastPrice) },
  { key: 'previousPrice', label: 'Prev (day)', numeric: true, value: (r) => val(r.previousPrice) },
  {
    key: 'book',
    label: 'Yes bid / ask',
    numeric: true,
    value: (r) => (r.yesBid === null && r.yesAsk === null ? dash : `${val(r.yesBid)} / ${val(r.yesAsk)}`),
  },
  { key: 'volume24h', label: '24h vol', numeric: true, value: (r) => val(r.volume24h) },
  { key: 'openInterest', label: 'Open interest', numeric: true, value: (r) => val(r.openInterest) },
  { key: 'closeTime', label: 'Closes', value: (r) => val(r.closeTime) },
  { key: 'source', label: 'Source', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>` },
];

function renderMarkets(filter) {
  const rows = MARKETS.filter((r) => (filter ? r.topicId === filter : r.topicId !== 'out_of_scope'));
  const thead = `<thead><tr>${cols
    .map((c) => `<th scope="col" class="${c.numeric ? 'num' : ''}">${esc(c.label)}</th>`)
    .join('')}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows
        .map((r) => `<tr>${cols.map((c) => `<td class="${c.numeric ? 'num' : ''}">${c.value(r)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
    : `<tbody><tr><td class="empty" colspan="${cols.length}">No markets in this topic at capture time. This is a real empty result, not an error — see the topic page for the exact query that returned it.</td></tr></tbody>`;
  document.getElementById('marketTable').innerHTML = `<div class="tablewrap"><table class="data">${thead}${tbody}</table></div>`;
  document.getElementById('marketNote').innerHTML =
    `Captured ${esc(CAPTURED_AT)} from <a href="${DEMO_REST}/markets?status=open" target="_blank" rel="noopener">GET /markets?status=open</a>. ` +
    `Prices are fixed-point dollar strings exactly as returned. Click through to the full <a href="markets.html">markets page</a> for volume, open interest and settlement sources.`;
}

const select = document.getElementById('topicFilter');
const topicOptions = [...new Map(MARKETS.map((m) => [m.topicId, m.topic])).entries()];
select.innerHTML += topicOptions.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
select.addEventListener('change', () => renderMarkets(select.value));
renderMarkets('');

/* ---------------- topic cards ---------------- */
const TOPIC_CARDS = [
  { id: 'gas', label: 'Gas Prices', file: 'topic-gas.html', note: 'Settles on AAA retail gasoline data. Kalshi files it under Economics with an “Oil &amp; Gas” tag.' },
  { id: 'elections', label: 'Elections', file: 'topic-elections.html', note: 'Its own Kalshi category. Includes US primaries, governorships and international elections.' },
  { id: 'culture', label: 'Culture', file: 'topic-culture.html', note: 'Its own Kalshi category. No open markets at capture time — reported honestly, not padded.' },
  { id: 'crypto', label: 'Crypto', file: 'topic-crypto.html', note: 'Settles on CF Benchmarks real-time indices, averaged over the final 60 seconds.' },
  { id: 'golf', label: 'Golf', file: 'topic-golf.html', note: 'Kalshi files golf under Sports with a “Golf” tag. Withdrawal rules differ per market type.' },
];

document.getElementById('topicCards').innerHTML = TOPIC_CARDS.map((t) => {
  const count = MARKETS.filter((m) => m.topicId === t.id).length;
  return `<div class="card tight">
    <span class="badge ${esc(t.id)}">${esc(t.label)}</span>
    <h3 style="margin:8px 0 4px"><a href="${esc(t.file)}">${esc(t.label)}</a></h3>
    <p style="margin:0 0 8px;font-size:13.5px">${t.note}</p>
    <span class="muted" style="font-size:12px">${count} market${count === 1 ? '' : 's'} captured</span>
  </div>`;
}).join('');

/* Requirements/flag counts are referenced in the hero buttons; keep them in sync. */
const flagBtn = document.querySelector('a[href="flagged.html"]');
if (flagBtn) flagBtn.textContent = `Flagged for review (${FLAGS.length})`;
const reqBtn = document.querySelector('a[href="requirements.html"]');
if (reqBtn) reqBtn.textContent = `Requirements traceability (${REQUIREMENTS.length}) →`;

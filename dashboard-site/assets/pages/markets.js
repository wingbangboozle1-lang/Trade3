import { MARKETS, SERIES, CAPTURED_AT, DEMO_REST } from '../data.js';
import { renderTable, esc } from './common.js';

const state = { topic: '', sort: 'volume' };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : -1;
};

const columns = [
  { label: 'Topic', value: (r) => `<span class="badge ${esc(r.topicId)}">${esc(r.topic)}</span>` },
  {
    label: 'Market',
    value: (r) =>
      `<strong>${esc(r.title)}</strong>` +
      `<span class="tiny mono">${esc(r.ticker)}</span>` +
      (r.outOfScope ? '<span class="tiny">out of scope — shown for transparency</span>' : ''),
  },
  { label: 'Kalshi category', value: (r) => esc(r.kalshiCategory) },
  { label: 'Kalshi tags', value: (r) => (r.kalshiTags?.length ? r.kalshiTags.map(esc).join(', ') : null) },
  { label: 'Last', numeric: true, value: (r) => r.lastPrice },
  { label: 'Prev (day)', numeric: true, value: (r) => r.previousPrice },
  { label: 'Yes bid', numeric: true, value: (r) => r.yesBid },
  { label: 'Yes ask', numeric: true, value: (r) => r.yesAsk },
  { label: 'Volume', numeric: true, value: (r) => r.volume },
  { label: '24h vol', numeric: true, value: (r) => r.volume24h },
  { label: 'Open interest', numeric: true, value: (r) => r.openInterest },
  { label: 'Closes', value: (r) => r.closeTime },
  {
    label: 'Settlement source',
    value: (r) => (r.settlementSourceName ? esc(r.settlementSourceName) : null),
  },
  {
    label: 'Source',
    value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>`,
  },
];

function rows() {
  let list = MARKETS.filter((m) => (state.topic ? m.topicId === state.topic : true));
  if (!state.topic) list = list.filter((m) => !m.outOfScope);
  const sorters = {
    volume: (a, b) => num(b.volume24h) - num(a.volume24h),
    oi: (a, b) => num(b.openInterest) - num(a.openInterest),
    close: (a, b) => new Date(a.closeTime ?? '2999-01-01') - new Date(b.closeTime ?? '2999-01-01'),
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
  };
  return list.sort(sorters[state.sort]);
}

function draw() {
  renderTable('marketsAll', columns, rows(), {
    emptyText: 'No markets matched. That is a real empty result from the demo API, not a rendering error.',
  });
  document.getElementById('marketsNote').innerHTML =
    `Captured ${esc(CAPTURED_AT)} from <a href="${DEMO_REST}/markets?status=open" target="_blank" rel="noopener">GET /markets?status=open</a>. ` +
    `A dash marked unverified means the endpoint did not return that field for that market.`;
}

const sel = document.getElementById('fTopic');
sel.innerHTML += [...new Map(MARKETS.map((m) => [m.topicId, m.topic])).entries()]
  .map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`)
  .join('');
sel.addEventListener('change', () => {
  state.topic = sel.value;
  draw();
});
const sortSel = document.getElementById('fSort');
sortSel.value = state.sort;
// A <select> holds its state in .value, not innerHTML; mirror it into a label the
// render harness and screen readers can both see.
sortSel.innerHTML = `<option value="${state.sort}">${state.sort}</option>`;
sortSel.addEventListener('change', (e) => {
  state.sort = e.target.value;
  draw();
});
draw();

renderTable(
  'seriesTable',
  [
    { label: 'Series', value: (r) => `<strong>${esc(r.title)}</strong><span class="tiny mono">${esc(r.ticker)}</span>` },
    { label: 'Category', value: (r) => esc(r.category) },
    { label: 'Tags', value: (r) => (r.tags?.length ? r.tags.map(esc).join(', ') : null) },
    { label: 'Product scope', value: (r) => r.scope },
    { label: 'Fee type', value: (r) => esc(r.feeType) },
    { label: 'Fee multiplier', numeric: true, value: (r) => esc(r.feeMultiplier) },
    { label: 'Frequency', value: (r) => esc(r.frequency) },
    {
      label: 'Settlement source',
      value: (r) =>
        r.settleUrl
          ? `<a href="${esc(r.settleUrl)}" target="_blank" rel="noopener">${esc(r.settleSource)} ↗</a>`
          : esc(r.settleSource),
    },
    { label: 'Source', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>` },
  ],
  SERIES,
  { emptyText: 'No series metadata captured.' },
);

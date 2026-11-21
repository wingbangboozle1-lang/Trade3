import { MARKETS, SERIES, EMPTY_TOPIC_NOTES, CAPTURED_AT, DEMO_REST } from '../data.js';
import { renderTable, esc } from './common.js';

const topicId = window.TOPIC_ID;
const rows = MARKETS.filter((m) => m.topicId === topicId);

renderTable(
  'topicMarkets',
  [
    { label: 'Market', value: (r) => `<strong>${esc(r.title)}</strong><span class="tiny mono">${esc(r.ticker)}</span>` },
    { label: 'Last', numeric: true, value: (r) => r.lastPrice },
    { label: 'Prev (day)', numeric: true, value: (r) => r.previousPrice },
    { label: 'Yes bid', numeric: true, value: (r) => r.yesBid },
    { label: 'Yes ask', numeric: true, value: (r) => r.yesAsk },
    { label: '24h vol', numeric: true, value: (r) => r.volume24h },
    { label: 'Open interest', numeric: true, value: (r) => r.openInterest },
    { label: 'Closes', value: (r) => r.closeTime },
    { label: 'Rules', value: (r) => `<span style="font-size:12px">${esc(r.rules)}</span>` },
    { label: 'Source', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>` },
  ],
  rows,
  { emptyText: 'No open markets in this topic at capture time. This is a verified empty result, not a missing page.' },
);

const note = EMPTY_TOPIC_NOTES[topicId];
document.getElementById('topicNote').innerHTML = rows.length
  ? `Captured ${esc(CAPTURED_AT)}. Every row links to the exact <code>GET /markets/{ticker}</code> response it came from.`
  : note
    ? `${esc(note.finding)}<br>Captured ${esc(note.checkedAt)} · <a href="${esc(note.sourceUrl)}" target="_blank" rel="noopener">verify the empty market list ↗</a> · <a href="${esc(note.alsoUrl)}" target="_blank" rel="noopener">verify the series exists ↗</a>`
    : `Captured ${esc(CAPTURED_AT)}. <a href="${DEMO_REST}/markets?status=open" target="_blank" rel="noopener">Verify against the live API ↗</a>`;

const series = SERIES.filter((s) => {
  const byTopic = {
    gas: ['KXAAAGASM'],
    golf: ['KXPGATOUR'],
    crypto: ['KXBTCD'],
    elections: ['GOVPARTYVA'],
    culture: ['KXXBANNEDGROK'],
  };
  return (byTopic[topicId] ?? []).includes(s.ticker);
});

renderTable(
  'topicSeries',
  [
    { label: 'Series', value: (r) => `<strong>${esc(r.title)}</strong><span class="tiny mono">${esc(r.ticker)}</span>` },
    { label: 'Category', value: (r) => esc(r.category) },
    { label: 'Tags', value: (r) => (r.tags?.length ? r.tags.map(esc).join(', ') : null) },
    { label: 'Product scope', value: (r) => r.scope },
    { label: 'Frequency', value: (r) => esc(r.frequency) },
    { label: 'Fee multiplier', numeric: true, value: (r) => esc(r.feeMultiplier) },
    {
      label: 'Settlement source',
      value: (r) =>
        r.settleUrl
          ? `<a href="${esc(r.settleUrl)}" target="_blank" rel="noopener">${esc(r.settleSource)} ↗</a>`
          : esc(r.settleSource),
    },
    {
      label: 'Settlement source',
      value: (r) =>
        r.settleUrl
          ? `<a href="${esc(r.settleUrl)}" target="_blank" rel="noopener">${esc(r.settleSource)} ↗</a>`
          : esc(r.settleSource),
    },
    { label: 'Source', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>` },
  ].filter((c, i, arr) => arr.findIndex((x) => x.label === c.label) === i),
  series,
  { emptyText: 'No series metadata recorded for this topic.' },
);

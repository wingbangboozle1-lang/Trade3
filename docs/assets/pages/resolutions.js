import { DEMO_REST, CAPTURED_AT } from '../data.js';
import { renderTable, esc } from './common.js';

renderTable(
  'resolutionTable',
  [
    { label: 'Market', value: (r) => `<strong>${esc(r.title)}</strong>` },
    { label: 'Result', value: (r) => `<span class="badge ${r.result === 'yes' ? 'ok' : 'bad'}">${esc(r.result.toUpperCase())}</span>` },
    { label: 'Settled at', value: (r) => esc(r.settledAt) },
    { label: 'Source', value: (r) => `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">API ↗</a>` },
  ],
  [],
  {
    emptyText:
      `No settled markets in the five topics were returned by the demo API at capture time (${CAPTURED_AT}). ` +
      `Verify: ${DEMO_REST}/markets?status=settled`,
  },
);

const lifecycle = [
  ['initialized', 'Market created but not yet open.', 'Not tracked.'],
  ['inactive', 'Market not currently tradable.', 'Shown, no alerts.'],
  ['active', 'Open and tradable.', 'Polled; alerts can fire.'],
  ['closed', 'Trading stopped, awaiting determination.', 'Polled; no new alerts expected.'],
  ['determined', 'Outcome determined.', 'Result read as soon as it appears.'],
  ['disputed', 'Outcome under dispute.', 'Held open; simulated trades not settled.'],
  ['amended', 'Determination amended.', 'Resolution log updated once.'],
  ['finalized', 'Final and settled.', 'Logged as resolved; paper positions settled.'],
];

renderTable(
  'lifecycleTable',
  [
    { label: 'Status', value: (r) => `<code>${esc(r[0])}</code>` },
    { label: 'Meaning', value: (r) => esc(r[1]) },
    { label: 'Dashboard behaviour', value: (r) => esc(r[2]) },
    {
      label: 'Source',
      value: () => `<a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">docs ↗</a>`,
    },
  ],
  lifecycle,
);

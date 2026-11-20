import { renderTable, esc } from './common.js';

export const STRATEGIES = [
  {
    id: 'momentum',
    label: 'Momentum',
    thesis: 'Buy in the direction of a $0.10 swing; assumes the move continues.',
    entry: 'Enter on the swing alert, side = swing direction.',
    exit: 'Exit at +$0.15 favourable, −$0.08 adverse, or at market close.',
    size: '$5.00 of paper cash',
    fail: 'Fails when the move is noise and mean-reverts immediately.',
  },
  {
    id: 'mean_revert',
    label: 'Mean reversion',
    thesis: 'Fade a $0.10 swing; assumes the move overshoots and partially retraces.',
    entry: 'Enter opposite the swing direction.',
    exit: 'Exit at +$0.10 favourable, −$0.12 adverse, or at market close.',
    size: '$5.00 of paper cash',
    fail: 'Fails when the swing is information and keeps going.',
  },
  {
    id: 'threshold_break',
    label: 'Threshold break',
    thesis: 'Trade a price crossing a round level (0.50, or 0.25/0.75) with momentum.',
    entry: 'Enter when the swing crosses a round level, in the swing direction.',
    exit: 'Exit at +$0.20 favourable, −$0.10 adverse, or at market close.',
    size: '$7.50 of paper cash',
    fail: 'Fails when a level breaks and immediately stalls, paying spread twice.',
  },
  {
    id: 'fade_extreme',
    label: 'Fade extreme',
    thesis: 'Bet against swings that push a contract above $0.85 or below $0.15.',
    entry: 'Enter when a swing lands in an extreme band, betting against it.',
    exit: 'Exit at +$0.10 favourable, −$0.15 adverse, or at market close.',
    size: '$4.00 of paper cash',
    fail: 'Fails badly when a contract is genuinely resolving and goes to $1 or $0.',
  },
];

document.getElementById('strategyCards').innerHTML = STRATEGIES.map(
  (s) => `<div class="card tight">
    <span class="badge info">${esc(s.label)}</span>
    <h3 style="margin:8px 0 6px">${esc(s.thesis)}</h3>
    <p style="margin:0 0 6px;font-size:13.5px"><strong>Entry:</strong> ${esc(s.entry)}</p>
    <p style="margin:0 0 6px;font-size:13.5px"><strong>Exit:</strong> ${esc(s.exit)}</p>
    <p style="margin:0 0 6px;font-size:13.5px"><strong>Default size:</strong> ${esc(s.size)} (capped at 5% of paper cash)</p>
    <p class="muted" style="margin:0;font-size:12.5px">${esc(s.fail)}</p>
  </div>`,
).join('');

renderTable(
  'exitTable',
  [
    { label: 'Strategy', value: (r) => `<strong>${esc(r.label)}</strong>` },
    { label: 'Take profit', numeric: true, value: (r) => esc(r.tp) },
    { label: 'Stop loss', numeric: true, value: (r) => esc(r.sl) },
    { label: 'Also closes on', value: () => 'market close, or official settlement' },
    {
      label: 'Official basis',
      value: () =>
        '<a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">official ↗</a>',
    },
  ],
  [
    { label: 'Momentum', tp: '+$0.15', sl: '−$0.08' },
    { label: 'Mean reversion', tp: '+$0.10', sl: '−$0.12' },
    { label: 'Threshold break', tp: '+$0.20', sl: '−$0.10' },
    { label: 'Fade extreme', tp: '+$0.10', sl: '−$0.15' },
  ],
);

renderTable(
  'strategyResults',
  [
    { label: 'Strategy', value: (r) => `<strong>${esc(r.label)}</strong>` },
    { label: 'Closed trades', numeric: true, value: () => '' },
    { label: 'Win rate', numeric: true, value: () => '' },
    { label: 'P&L', numeric: true, value: () => '' },
    { label: 'Official basis', value: () => '<a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">official ↗</a>' },
  ],
  [],
  {
    emptyText:
      'No simulated trades have closed in this static capture. Counters are blank on purpose: a zero would imply a measured result, and there is none yet.',
  },
);

/* Replace the placeholder cells with an explicit honest message on the first row only. */
const wrap = document.querySelector('#strategyResults .tablewrap');
if (wrap) {
  wrap.insertAdjacentHTML(
    'afterend',
    `<p class="source-note">All counters are blank because no simulated trades have closed in this static
     capture. They are deliberately not filled with zeros: a zero would imply a measured result, and there is none.
     Run <code>npm start</code> with network access to populate this table from live alerts.</p>`,
  );
}

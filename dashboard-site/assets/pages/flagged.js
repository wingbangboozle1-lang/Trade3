import { FLAGS } from '../data.js';
import { esc, kpis } from './common.js';

const sev = (s) => (s === 'High' ? 'bad' : s === 'Medium' ? 'warn' : 'info');
const high = FLAGS.filter((f) => f.severity === 'High').length;
const med = FLAGS.filter((f) => f.severity === 'Medium').length;

kpis('flagKpis', [
  ['Total flags', String(FLAGS.length), 'all published'],
  ['High severity', String(high), 'changes how to read the site'],
  ['Medium', String(med), 'judgement calls'],
  ['Low', String(FLAGS.length - high - med), 'recorded for later'],
]);

document.getElementById('flagList').innerHTML = FLAGS.map(
  (f) => `<div class="card" id="${esc(f.id)}">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <span class="badge ${sev(f.severity)}">${esc(f.severity)} severity</span>
      <code>${esc(f.id)}</code>
      <strong style="font-size:15px">${esc(f.item)}</strong>
    </div>
    <p style="margin:0 0 10px">${esc(f.detail)}</p>
    <p style="margin:0 0 10px;font-size:13px;color:#9fb3c8"><strong>Evidence:</strong> ${esc(f.evidence)}</p>
    <p style="margin:0 0 10px;font-size:13px"><strong>Status:</strong> ${esc(f.status)}</p>
    <p style="margin:0;font-size:13px">
      <a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener">Verify this ↗</a>
      ${f.alsoUrl ? ` · <a href="${esc(f.alsoUrl)}" target="_blank" rel="noopener">Second source ↗</a>` : ''}
    </p>
  </div>`,
).join('');


/* ---- flags carried over from the parallel session's build ---- */
const OTHER_FLAGS = [
  ['F1', '“Culture” topic mapping', 'That build states Kalshi has no Culture category and uses Entertainment as a proxy.', 'https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture', 'Corrected above: the Culture category exists.'],
  ['F2', 'News / catalyst attribution for ≥ $0.10 jumps', 'Kalshi provides no news feed, so any causal claim would be unverified.', 'https://docs.kalshi.com/getting_started/quick_start_market_data', 'Agrees with F5 above.'],
  ['F3', 'Live demo execution + WebSocket streaming', 'Both need a demo API key and private key, which are never committed.', 'https://docs.kalshi.com/getting_started/quick_start_websockets', 'Agrees with this build’s approach.'],
  ['F4', 'Definition of “highest dollar amount”', 'Kalshi has no dollar-volume field, so ranking uses volume × price.', 'https://docs.kalshi.com/api-reference/market/get-markets', 'This build ranks by 24h contract volume and book notional, both stated on page.'],
  ['F5', 'High-ROI filter thresholds', 'Heuristic thresholds are explicit but unvalidated.', 'https://docs.kalshi.com/getting_started/orderbook_responses', 'Agrees: this build exposes its threshold (45) as one constant.'],
  ['F6', 'Browser CORS for the live API', 'Public REST may or may not be fetchable from a browser origin.', 'https://docs.kalshi.com/getting_started/quick_start_market_data', 'This build avoids the question by serving through a local collector, so no CORS is involved.'],
  ['F7', 'Static price/volume values', 'Static tables should not snapshot live values as facts.', 'https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open', 'This build does snapshot, but stamps every capture with a timestamp and an API link.'],
];

document.getElementById('otherFlags').innerHTML = `<div class="tablewrap"><table class="data">
  <thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col">Their finding</th><th scope="col">Source</th><th scope="col">Status from this build</th></tr></thead>
  <tbody>${OTHER_FLAGS.map(
    ([id, item, finding, src, status]) =>
      `<tr><td><code>${esc(id)}</code></td><td><strong>${esc(item)}</strong></td><td>${esc(finding)}</td>` +
      `<td><a href="${esc(src)}" target="_blank" rel="noopener">official ↗</a></td><td>${esc(status)}</td></tr>`,
  ).join('')}</tbody></table></div>`;

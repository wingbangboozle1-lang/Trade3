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

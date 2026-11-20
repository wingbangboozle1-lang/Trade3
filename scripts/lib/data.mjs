// Loads the research data (sources, topics, findings) and turns it into site pages.
//
// THE VERIFICATION RULE, enforced here and by scripts/verify-sources.mjs:
//   every table row that states a fact must carry a `source_id` that resolves to an
//   official URL, or be explicitly marked `unverified: true`. A row that is marked
//   unverified is rendered BLANK in the value columns and is also listed on the
//   Flagged for Review page. Nothing is ever inferred to fill a gap.

import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');

export function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

export function loadSources() {
  const doc = readJson('research/sources.json');
  return doc.sources;
}

export function loadTopics() {
  return readJson('research/topics.json');
}

/** Resolve a source id to its official URL, or null. */
export function sourceUrl(sources, id) {
  const s = sources[id];
  return s ? s.url : null;
}

/** The one-line provenance string used in every table cell. */
export function sourceCell(sources, id) {
  const s = sources[id];
  if (!s) return '<span class="flag">no source</span>';
  return `<a href="${s.url}" target="_blank" rel="noopener" title="${escapeAttr(s.title)}">${id}</a>`;
}

export function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Validate a table's rows: every row needs a title, a source_id (or unverified) and
 * a date. Returns a list of problems; an empty list means the table is publishable.
 */
export function validateRows(rows, sources, tableName) {
  const problems = [];
  rows.forEach((row, idx) => {
    const where = `${tableName} row ${idx + 1} (${row.item || row.name || 'unnamed'})`;
    if (row.unverified) return; // allowed, but must appear on the flagged page
    if (!row.source_id) problems.push(`${where}: missing source_id`);
    else if (!sources[row.source_id]) problems.push(`${where}: source_id ${row.source_id} is not in sources.json`);
    if (!row.as_of) problems.push(`${where}: missing as_of date`);
  });
  return problems;
}

/**
 * Render one row, blanking values that are flagged unverified. `cells` is a list of
 * { key, fmt } describing which fields to print.
 */
export function renderRow(row, sources, cells) {
  const flagged = Boolean(row.unverified);
  const tds = cells
    .map((c) => {
      const raw = row[c.key];
      const value = flagged ? '' : raw;
      const text = value === undefined || value === null || value === '' ? '—' : c.fmt ? c.fmt(value) : esc(value);
      return `<td${c.num ? ' class="num"' : ''}${flagged ? ' class="blank"' : ''}>${text}</td>`;
    })
    .join('');
  const src = flagged ? '<span class="flag">unverified</span>' : sourceCell(sources, row.source_id);
  const note = row.note ? `<div class="rownote">${esc(row.note)}</div>` : '';
  return `<tr${flagged ? ' class="unverified"' : ''}>${tds}<td>${src}</td></tr>${note}`;
}

export function table(headers, rowsHtml, { numFrom = 99 } = {}) {
  const th = headers.map((h, i) => `<th${i >= numFrom ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>`;
}

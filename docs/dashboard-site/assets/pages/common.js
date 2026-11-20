/** Shared table renderer for the published site. Values of null render as unverified. */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const UNVERIFIED = '<span class="unverified" title="Not returned by the official source — left blank on purpose">— unverified</span>';

export function cell(value) {
  if (value === null || value === undefined || value === '') return UNVERIFIED;
  return value;
}

/**
 * columns: [{ label, numeric?, value(row) | key }]
 */
export function renderTable(targetId, columns, rows, { emptyText = 'No rows.' } = {}) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const thead = `<thead><tr>${columns
    .map((c) => `<th scope="col" class="${c.numeric ? 'num' : ''}">${esc(c.label)}</th>`)
    .join('')}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${columns
              .map((c) => {
                const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
                return `<td class="${c.numeric ? 'num' : ''}">${cell(raw)}</td>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td class="empty" colspan="${columns.length}">${esc(emptyText)}</td></tr></tbody>`;
  target.innerHTML = `<div class="tablewrap"><table class="data">${thead}${tbody}</table></div>`;
}

export function ext(url, label) {
  if (!url) return UNVERIFIED;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || url)} ↗</a>`;
}

export function badge(map, key) {
  const [cls, text] = map[key] ?? ['info', key];
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

export const STATUS_BADGE = {
  Delivered: 'ok',
  'Delivered, needs an API key': 'warn',
  'Implemented, disabled by default': 'info',
  'Partially delivered — logged': 'warn',
};

export function statusBadge(status) {
  return `<span class="badge ${STATUS_BADGE[status] ?? 'info'}">${esc(status)}</span>`;
}

export function kpis(targetId, items) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = items
    .map(([label, value, sub]) => `<div class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`)
    .join('');
}

export { esc };

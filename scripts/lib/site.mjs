// Shared page chrome for the generated site: head, nav, footer, and the small
// components every page reuses (source chips, flags, empty states).
//
// The generated site is plain static HTML with one stylesheet and almost no JS, so it
// works on GitHub Pages with no build step, no server, and no tracking.

import { esc } from './data.mjs';

export const SITE_NAME = 'Kalshi demo — live events, swings, and simulated trading';

export const CATEGORIES = [
  { id: 'gas', name: 'Gas prices' },
  { id: 'elections', name: 'Elections' },
  { id: 'culture', name: 'Culture' },
  { id: 'crypto', name: 'Crypto' },
  { id: 'golf', name: 'Golf' }
];

export function nav(active) {
  const link = (href, label, id) =>
    `<a href="${href}" class="${active === id ? 'on' : ''}">${esc(label)}</a>`;
  return `<header class="site">
    <a class="logo" href="index.html">Kalshi demo · Trade3</a>
    <nav>
      ${link('index.html', 'Overview', 'overview')}
      ${CATEGORIES.map((c) => link(`${c.id}.html`, c.name, c.id)).join('')}
      ${link('executive-summary.html', 'Executive summary', 'summary')}
      ${link('requirements.html', 'Requirements', 'requirements')}
      ${link('api-contracts.html', 'API contracts', 'api')}
      ${link('fees.html', 'Fees', 'fees')}
      ${link('findings.html', 'Findings', 'findings')}
      ${link('suggestions.html', 'Suggestions', 'suggestions')}
      ${link('sources.html', 'Sources', 'sources')}
      ${link('flagged.html', 'Flagged for review', 'flagged')}
    </nav>
  </header>`;
}

export function page({ title, active, body, description = '', depth = 0 }) {
  const prefix = depth ? '../'.repeat(depth) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Trade3</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${prefix}style.css">
<link rel="icon" href="${prefix}favicon.svg">
</head>
<body>
${nav(active).replace(/href="/g, `href="${prefix}`)}
<main>
${body}
</main>
<footer class="site">
  <p>
    Generated ${new Date().toISOString().slice(0, 10)} from this repository's own files.
    Every factual row links to an official Kalshi (or other primary) source; see
    <a href="${prefix}sources.html">Sources</a> and <a href="${prefix}flagged.html">Flagged for review</a>.
  </p>
  <p class="mute">
    Kalshi demo environment only. Kalshi documents that demo prices and behaviour
    "may not be reflective of those in real markets". Nothing here is investment advice.
  </p>
</footer>
<script src="${prefix}app.js" defer></script>
</body>
</html>`;
}

export function banner(text, kind = 'warn') {
  return `<div class="banner ${kind}">${text}</div>`;
}

export function section(id, heading, html, note = '') {
  return `<section id="${id}">
  <h2>${esc(heading)}</h2>
  ${note ? `<p class="secnote">${note}</p>` : ''}
  ${html}
</section>`;
}

export function emptyState(title, detail) {
  return `<div class="empty"><b>${esc(title)}</b><p>${detail}</p></div>`;
}

/**
 * Render a list of source links. `retrieved` comes from the source record itself, so
 * a page can never claim a retrieval date that the registry does not record.
 */
export function sourceList(sources, ids, retrieved) {
  return ids
    .map((id) => {
      const s = sources[id];
      if (!s) return '';
      return `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="mute">(${esc(
        s.publisher
      )}${retrieved ? `, retrieved ${esc(retrieved)}` : ''})</span></li>`;
    })
    .join('');
}

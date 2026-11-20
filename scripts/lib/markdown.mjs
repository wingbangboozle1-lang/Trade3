// Minimal markdown -> HTML renderer for the generated site.
//
// Scope is deliberately narrow: headings, paragraphs, lists, tables, bold/italic,
// inline code, links, code fences, blockquotes and horizontal rules. Anything else
// is escaped and shown as text rather than silently dropped — a documentation page
// that loses content is worse than one that shows a stray character.
//
// Why not a dependency: the repo has no build step and no node_modules, so the site
// can be rebuilt by anyone with a bare Node install.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text) {
  let s = esc(text);
  // inline code first so nothing inside it gets processed
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const external = /^https?:/.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  // A bare reference that had no definition (should not happen, but never drop the
  // text): render it as a plain code span so it is visible on the page.
  s = s.replace(/\[([A-Z][A-Za-z0-9_\-\/]{1,12})\]/g, '<code>$1</code>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

function renderTable(lines) {
  const rows = lines.filter((l) => l.trim().startsWith('|'));
  // header + separator + at least one body row; anything less is a stray pipe line,
  // not a table, and rendering it would publish an empty table.
  if (rows.length < 3) return '';
  if (!/^\|?[\s:-]*-[\s|:-]*$/.test(rows[1])) return '';
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const align = cells(rows[1]).map((c) => (/^:?-+:$/.test(c) ? (c.endsWith(':') ? 'right' : 'left') : 'left'));
  const th = head.map((h, i) => `<th${align[i] === 'right' ? ' class="num"' : ''}>${inline(h)}</th>`).join('');
  const trs = body
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${align[i] === 'right' ? ' class="num"' : ''}>${inline(c)}</td>`)
          .join('')}</tr>`
    )
    .join('\n');
  return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/**
 * Pre-process GitHub-style reference links: a line `[K1]: https://...` defines K1,
 * and any `[K1]` elsewhere becomes a link to it. This matters here because the
 * research documents use reference links to keep every claim tied to a source URL,
 * and dropping them would lose the citation.
 */
function resolveReferences(src) {
  const defs = new Map();
  const kept = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^\[([A-Za-z0-9_.\-\/ ]+)\]:\s*(\S+)\s*$/);
    if (m) {
      defs.set(m[1], m[2]);
      kept.push(''); // the definition itself is not rendered
    } else {
      kept.push(line);
    }
  }
  let out = kept.join('\n');
  if (defs.size) {
    out = out.replace(/\[([A-Za-z0-9_.\-\/ ]+)\](?!\()/g, (full, id) => {
      const url = defs.get(id);
      if (!url) return full;
      const external = /^https?:/.test(url);
      const label = id.includes('/') ? id.split('/').pop() : id;
      return `[${label}](${url})`;
    });
  }
  return out;
}

export function renderMarkdown(srcRaw) {
  const src = resolveReferences(String(srcRaw).replace(/\r\n/g, '\n'));
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const id = h[2]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(buf));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push(`<ul>${buf.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      out.push(`<ol>${buf.map((b) => `<li>${inline(b)}</li>`).join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // paragraph: consume until blank or a structural line
    const buf = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

export { esc };

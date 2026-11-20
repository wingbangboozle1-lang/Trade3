/* Shared helpers for the published static site. No build step, no dependencies. */
(function () {
  const base = document.querySelector('link[rel="canonical"]')?.href
    ? new URL('.', document.querySelector('link[rel="canonical"]').href).pathname
    : '/';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(child));
    }
    return node;
  }

  /**
   * Build a table from a column spec.
   * A cell value of null/undefined/'' renders as an em dash plus an "unverified"
   * marker, per the verification rule: never infer, never fill in.
   */
  function table(columns, rows, opts = {}) {
    const thead = el('thead', {}, [
      el('tr', {}, columns.map((c) => el('th', { scope: 'col', class: c.numeric ? 'num' : '' }, c.label))),
    ]);
    const tbody = el('tbody', {});
    if (!rows.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: String(columns.length), class: 'empty' }, opts.emptyText || 'No rows.')]));
    }
    for (const row of rows) {
      const tr = el('tr', {});
      for (const col of columns) {
        const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
        const td = el('td', { class: col.numeric ? 'num' : '' });
        if (raw === null || raw === undefined || raw === '') {
          td.append(el('span', { class: 'unverified', title: 'Not returned by the official source - left blank on purpose' }, '— unverified'));
        } else if (raw.nodeType) {
          td.append(raw);
        } else {
          td.innerHTML = String(raw);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    return el('table', { class: 'data' }, [thead, tbody]);
  }

  /** A source link cell: official API URL plus a human label. */
  function sourceLink(href, label) {
    return el('a', { href, target: '_blank', rel: 'noopener' }, label || 'source ↗');
  }

  function mount(id, node) {
    const target = document.getElementById(id);
    if (target) target.append(node);
  }

  /** Highlight the current page in the nav. */
  function markNav() {
    const here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav.main a').forEach((a) => {
      const href = a.getAttribute('href');
      if (href === here || (here === 'index.html' && href === './')) a.setAttribute('aria-current', 'page');
    });
  }

  document.addEventListener('DOMContentLoaded', markNav);

  window.Site = { el, table, sourceLink, mount, base };
})();

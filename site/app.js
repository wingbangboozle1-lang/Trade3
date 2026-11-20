// Tiny progressive enhancement for the static site. Everything works without it;
// this only adds a table filter and top-of-page anchor links.
(() => {
  'use strict';

  // Add a filter box above any table with more than 12 rows.
  document.querySelectorAll('.tablewrap').forEach((wrap) => {
    const tbody = wrap.querySelector('tbody');
    if (!tbody || tbody.rows.length < 12) return;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = `Filter ${tbody.rows.length} rows…`;
    input.setAttribute('aria-label', 'Filter table rows');
    input.style.cssText =
      'margin:10px 12px 0;padding:6px 10px;background:#0b0f17;border:1px solid #243244;border-radius:6px;color:#e6edf7;font:13px system-ui;min-width:240px';
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      [...tbody.rows].forEach((r) => {
        if (r.classList.contains('note')) return;
        r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    wrap.insertBefore(input, wrap.firstChild);
  });

  // Keyboard: "/" focuses the filter of the first table.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches('input, textarea')) {
      const first = document.querySelector('.tablewrap input[type=search]');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
})();

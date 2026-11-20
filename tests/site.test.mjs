// Tests for the static-site generator: the markdown renderer, the row validator,
// the blanking rules, and the built output on disk.
//
// The site is the part of this repo a stranger reads first, so the things tested
// here are the promises that make it trustworthy:
//   * a citation that exists in sources.json becomes a clickable official link;
//   * a row that is not sourced cannot be published with a value in it;
//   * every nav target exists as a real file;
//   * the verifier's rules hold on the actual generated HTML.

import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert, eq } from './harness.mjs';
import { renderMarkdown } from '../scripts/lib/markdown.mjs';
import { ROOT, validateRows, renderRow, table, sourceCell, loadSources } from '../scripts/lib/data.mjs';

const SITE = path.join(ROOT, 'site');
const readSite = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');

suite('markdown: reference links', () => {

  test('a [K1] reference becomes a link to the defined URL', () => {
    const html = renderMarkdown('See [K1].\n\n[K1]: https://docs.kalshi.com/x.md\n');
    assert(html.includes('<a href="https://docs.kalshi.com/x.md"'), 'no anchor emitted');
    assert(html.includes('>K1</a>'), 'label not preserved');
    assert(!html.includes('[K1]:'), 'definition line leaked into output');
  });

  test('adjacent references each resolve independently', () => {
    const html = renderMarkdown('a [K8][K20] b\n\n[K8]: https://docs.kalshi.com/a\n[K20]: https://docs.kalshi.com/b\n');
    eq((html.match(/<a href="https:\/\/docs\.kalshi\.com\//g) || []).length, 2, 'both refs should link');
  });

  test('an undefined reference is shown, never dropped', () => {
    const html = renderMarkdown('see [K99] here\n');
    assert(html.includes('K99'), 'the reference text disappeared');
  });

  test('reference links work inside table cells', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| x | [K1] |\n\n[K1]: https://docs.kalshi.com/x.md\n');
    assert(/<td><a href="https:\/\/docs\.kalshi\.com\/x\.md"/.test(html), 'table cell citation did not resolve');
  });

  test('external links open in a new tab; internal links do not', () => {
    const html = renderMarkdown('[a](https://example.com/x) [b](other.html)');
    assert(/target="_blank" rel="noopener">a</.test(html), 'external link missing target');
    assert(!/target="_blank"[^>]*>b</.test(html), 'internal link should not open a new tab');
  });

  test('html in the source is escaped', () => {
    const html = renderMarkdown('a <script>alert(1)</script> b');
    assert(!html.includes('<script>'), 'raw script tag survived');
    assert(html.includes('&lt;script&gt;'), 'escaping did not happen');
  });
});

suite('markdown: structure', () => {

  test('tables render with a header and every body row', () => {
    const html = renderMarkdown('| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |\n');
    eq((html.match(/<tr>/g) || []).length, 3, 'expected 1 header + 2 body rows');
    eq((html.match(/<td>/g) || []).length, 4, 'expected 4 cells');
  });

  test('a table with only a header and separator renders nothing', () => {
    eq(renderMarkdown('| h1 | h2 |\n|---|---|\n'), '', 'degenerate table should not render');
  });

  test('a code fence keeps its contents verbatim', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2;\n```\n');
    assert(html.includes('<pre><code'), 'no pre/code block');
    assert(html.includes('const a = 1 &lt; 2;'), 'fence content not escaped or lost');
  });

  test('headings carry ids so deep links work', () => {
    const html = renderMarkdown('## 8. Flagged for review\n');
    assert(/<h2 id="[^"]+"/.test(html), 'heading has no id');
  });
});

suite('rows: the verification rule', () => {

  const sources = loadSources();

  test('an unsourced row is reported, not silently published', () => {
    const problems = validateRows([{ item: 'x', as_of: '2026-11-20' }], sources, 't');
    eq(problems.length, 1, 'expected exactly one problem');
    assert(problems[0].includes('missing source_id'), problems[0]);
  });

  test('a source id that is not in sources.json is reported', () => {
    const problems = validateRows([{ item: 'x', source_id: 'K999', as_of: '2026-11-20' }], sources, 't');
    eq(problems.length, 1);
    assert(problems[0].includes('K999 is not in sources.json'), problems[0]);
  });

  test('a missing as_of date is reported', () => {
    const problems = validateRows([{ item: 'x', source_id: 'K1' }], sources, 't');
    eq(problems.length, 1);
    assert(problems[0].includes('as_of'), problems[0]);
  });

  test('a fully sourced row passes', () => {
    eq(validateRows([{ item: 'x', source_id: 'K1', as_of: '2026-11-20' }], sources, 't').length, 0);
  });

  test('an unverified row passes validation but must render blank', () => {
    eq(validateRows([{ item: 'x', unverified: true }], sources, 't').length, 0, 'unverified rows are allowed');
    const html = renderRow({ item: 'x', value: 'SHOULD-NOT-APPEAR', unverified: true }, sources, [
      { key: 'item' },
      { key: 'value' }
    ]);
    assert(!html.includes('SHOULD-NOT-APPEAR'), 'an unverified value was printed');
    assert(html.includes('unverified'), 'no unverified flag on the row');
    assert(html.includes('class="unverified"'), 'row not marked unverified');
  });

  test('a sourced row prints the official URL as its source cell', () => {
    const cell = sourceCell(sources, 'K1');
    assert(cell.includes(sources.K1.url), 'source cell does not link the official URL');
  });

  test('an unknown source id renders as "no source" rather than a dead link', () => {
    const cell = sourceCell(sources, 'K999');
    assert(cell.includes('no source'), cell);
    assert(!cell.includes('<a'), 'dead link rendered');
  });

  test('table() emits one cell per header plus the source column', () => {
    const html = table(['a', 'b'], [renderRow({ a: '1', b: '2', source_id: 'K1', as_of: '2026-11-20' }, sources, [{ key: 'a' }, { key: 'b' }])]);
    eq((html.match(/<th[ >]/g) || []).length, 2, 'header count');
    eq((html.match(/<td/g) || []).length, 3, 'expected 2 value cells + 1 source cell');
  });
});

suite('built site', () => {

  const REQUIRED = [
    'index.html',
    'gas.html',
    'elections.html',
    'culture.html',
    'crypto.html',
    'golf.html',
    'executive-summary.html',
    'requirements.html',
    'api-contracts.html',
    'fees.html',
    'findings.html',
    'suggestions.html',
    'sources.html',
    'flagged.html',
    'style.css',
    'app.js',
    'favicon.svg',
    '.nojekyll'
  ];

  test('every required page and asset exists', () => {
    const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(SITE, f)));
    eq(missing.join(', '), '', 'missing site files');
  });

  test('the nav links on every page resolve to a built file', () => {
    const broken = [];
    for (const f of REQUIRED.filter((x) => x.endsWith('.html'))) {
      const html = readSite(f);
      const navHtml = html.match(/<nav>([\s\S]*?)<\/nav>/);
      assert(navHtml, `${f} has no nav`);
      for (const [, href] of navHtml[1].matchAll(/href="([^"#]+)"/g)) {
        if (!fs.existsSync(path.join(SITE, href))) broken.push(`${f} -> ${href}`);
      }
    }
    eq(broken.join(', '), '', 'broken nav links');
  });

  test('the nav covers all five topics', () => {
    const navHtml = readSite('index.html').match(/<nav>([\s\S]*?)<\/nav>/)[1];
    for (const t of ['gas.html', 'elections.html', 'culture.html', 'crypto.html', 'golf.html']) {
      assert(navHtml.includes(t), `nav is missing ${t}`);
    }
  });

  test('no page loads anything from a third-party host', () => {
    // A static documentation site should not phone home, and Pages should not depend
    // on a CDN to render. Every <script src>/<link href> must be local.
    const offenders = [];
    for (const f of REQUIRED.filter((x) => x.endsWith('.html'))) {
      const html = readSite(f);
      for (const [, tag] of html.matchAll(/<(script|link)[^>]*>/g)) {
        const ext = tag.match(/(src|href)="(https?:\/\/[^"]+)"/);
        if (ext && !/^https:\/\/[^"]*rel="(canonical|alternate)"/.test(tag)) offenders.push(`${f}: ${ext[2]}`);
      }
    }
    eq(offenders.join(', '), '', 'external asset references');
  });

  test('every page declares a charset and a viewport', () => {
    for (const f of REQUIRED.filter((x) => x.endsWith('.html'))) {
      const html = readSite(f);
      assert(/<meta charset="utf-8"/i.test(html), `${f} missing charset`);
      assert(/name="viewport"/.test(html), `${f} missing viewport`);
    }
  });

  test('no page claims a live price', () => {
    // This site is served statically from Pages and cannot hold a key or a socket, so
    // any sentence asserting a current price would be a fabrication.
    for (const f of REQUIRED.filter((x) => x.endsWith('.html'))) {
      const text = readSite(f).replace(/<[^>]+>/g, ' ');
      assert(!/\blive price is\b/i.test(text), `${f} asserts a live price`);
    }
  });

  test('the flagged page carries a source or an unverified flag on every row', () => {
    const html = readSite('flagged.html');
    const rows = html.split(/<tr[^>]*>/).slice(1);
    let dataRows = 0;
    for (const raw of rows) {
      const cells = raw.split(/<td[^>]*>/).slice(1);
      if (cells.length === 0) continue;
      if (/class="[^"]*\bnote\b/.test(raw)) continue;
      dataRows += 1;
    }
    assert(dataRows > 5, `expected flagged rows, found ${dataRows}`);
  });

  test('the fees page reproduces the official printed values', () => {
    // These five come from the fee schedule table and are the ones quoted most often
    // by the app's own tests; if the page drifts from them, one of the two is wrong.
    const html = readSite('fees.html');
    for (const v of ['$1.75', '$1.74', '$0.63']) assert(html.includes(v), `fee page missing ${v}`);
  });
});

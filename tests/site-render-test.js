/**
 * Renders every published page script against a minimal DOM shim and asserts the
 * output is real content, not an error page.
 *
 * Why this exists: the sandbox cannot download a headless browser, but a page script
 * that throws on import, references a missing element, or prints "undefined" is a
 * broken site regardless. This harness executes the exact modules the browser loads.
 *
 * Run: node tests/site-render-test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

/* ---------------- minimal DOM shim ---------------- */
class FakeEl {
  constructor(id) {
    this.id = id;
    this._html = '';
    this.listeners = {};
    this.options = [];
    this.value = '';
    this.className = '';
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text ?? ''; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, event = {}) { (this.listeners[type] ?? []).forEach((fn) => fn(event)); }
  append() {}
  appendChild() {}
  insertAdjacentHTML(_pos, html) { this._html += String(html); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
}

const elements = new Map();
const document_ = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeEl(id));
    return elements.get(id);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return new FakeEl('created'); },
  body: new FakeEl('body'),
};

globalThis.document = document_;
globalThis.window = globalThis;
globalThis.location = { pathname: '/', href: 'http://localhost/' };
globalThis.Node = { ELEMENT_NODE: 1 };

/* ---------------- run each page script ---------------- */
const PAGES = [
  ['overview.js', 'index.html', ['liveKpis', 'summaryBody', 'keyFindings', 'marketTable', 'topicCards', 'topicFilter']],
  ['markets.js', 'markets.html', ['marketsAll', 'seriesTable', 'fTopic', 'fSort', 'marketsNote']],
  ['topics.js', 'topics.html', ['topicTable', 'topicLinks']],
  ['topic.js', 'topic-gas.html', ['topicMarkets', 'topicSeries', 'topicNote']],
  ['resolutions.js', 'resolutions.html', ['resolutionTable', 'lifecycleTable']],
  ['strategies.js', 'strategies.html', ['strategyCards', 'exitTable', 'strategyResults']],
  ['recommendations.js', 'recommendations.html', ['recTable', 'recDetails']],
  ['executive.js', 'executive-summary.html', ['deliverables', 'endpointTable', 'summaryFindings', 'flagsMini']],
  ['requirements.js', 'requirements.html', ['reqKpis', 'reqTable', 'testTable']],
  ['flagged.js', 'flagged.html', ['flagKpis', 'flagList']],
  ['sources.js', 'sources.html', ['docSources', 'apiSources', 'thirdPartySources']],
];

const results = [];
let failures = 0;

for (const [script, htmlFile, requiredIds] of PAGES) {
  const label = `${script} -> ${htmlFile}`;
  elements.clear();
  globalThis.TOPIC_ID = htmlFile.includes('topic-') ? htmlFile.replace('topic-', '').replace('.html', '') : undefined;
  try {
    // Load the HTML so we can assert each id really exists on the page.
    const html = fs.readFileSync(path.join(DOCS, htmlFile), 'utf8');
    for (const id of requiredIds) {
      if (!html.includes(`id="${id}"`)) throw new Error(`page ${htmlFile} has no element with id="${id}"`);
    }

    const url = `${pathToFileURL(path.join(DOCS, 'assets', 'pages', script)).href}?v=${Date.now()}`;
    await import(url);

    // Every required id must now hold rendered content.
    const empty = requiredIds.filter((id) => !elements.get(id) || elements.get(id).innerHTML.trim() === '');
    if (empty.length) throw new Error(`rendered nothing into: ${empty.join(', ')}`);

    // Guard against template bugs that print undefined into the page.
    const bad = [...elements.entries()].filter(([, el]) => /(^|[^a-zA-Z])undefined([^a-zA-Z]|$)/.test(el.innerHTML));
    if (bad.length) throw new Error(`"undefined" appears in rendered output of: ${bad.map(([id]) => id).join(', ')}`);

    // Every rendered table must have a source link, unless it is explicitly an empty state.
    for (const [id, el] of elements) {
      if (el.innerHTML.includes('<table')) {
        const hasSource = el.innerHTML.includes('API ↗') || el.innerHTML.includes('docs ↗') || el.innerHTML.includes('source ↗') || el.innerHTML.includes('official ↗') || el.innerHTML.includes('verify');
        const isEmptyState = el.innerHTML.includes('class="empty"');
        if (!hasSource && !isEmptyState) throw new Error(`table in #${id} has no source link and is not an empty state`);
      }
    }

    results.push(`PASS ${label}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL ${label}: ${err.message}`);
  }
}

/* ---------------- data integrity ---------------- */
try {
  const data = await import(pathToFileURL(path.join(DOCS, 'assets', 'data.js')).href);
  const problems = [];

  for (const m of data.MARKETS) {
    if (!m.ticker) problems.push('market without ticker');
    if (!m.sourceUrl?.startsWith('https://external-api.demo.kalshi.co/')) {
      problems.push(`${m.ticker}: sourceUrl is not an official demo API URL`);
    }
    for (const field of ['lastPrice', 'yesBid', 'volume24h']) {
      if (m[field] !== null && !/^-?\d+(\.\d+)?$/.test(String(m[field]))) {
        problems.push(`${m.ticker}: ${field} is not a numeric string (${m[field]})`);
      }
    }
  }

  for (const s of data.SERIES) {
    if (!s.sourceUrl?.startsWith('https://external-api.demo.kalshi.co/')) {
      problems.push(`${s.ticker}: series sourceUrl is not an official demo API URL`);
    }
  }

  for (const r of data.REQUIREMENTS) {
    if (!r.source?.startsWith('https://')) problems.push(`${r.id}: requirement has no https source`);
    if (!r.status) problems.push(`${r.id}: requirement has no status`);
  }

  for (const f of data.FLAGS) {
    if (!f.sourceUrl?.startsWith('https://')) problems.push(`${f.id}: flag has no https source`);
    if (!['High', 'Medium', 'Low'].includes(f.severity)) problems.push(`${f.id}: bad severity`);
  }

  if (problems.length) throw new Error(problems.join('; '));
  results.push(`PASS data integrity (${data.MARKETS.length} markets, ${data.SERIES.length} series, ${data.REQUIREMENTS.length} requirements, ${data.FLAGS.length} flags)`);
} catch (err) {
  failures += 1;
  results.push(`FAIL data integrity: ${err.message}`);
}

/* ---------------- every page has a title and a nav-loaded shell ---------------- */
try {
  const htmlFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
  const problems = [];
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(DOCS, f), 'utf8');
    if (!/<title>[^<]{10,}<\/title>/.test(html)) problems.push(`${f}: missing or short <title>`);
    if (!/name="description"/.test(html)) problems.push(`${f}: missing meta description`);
    if (!html.includes('assets/shell.js')) problems.push(`${f}: does not load the shared nav/footer shell`);
    if (!html.includes('assets/site.css')) problems.push(`${f}: does not load the stylesheet`);
    if (!/id="main"/.test(html)) problems.push(`${f}: missing main landmark`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  results.push(`PASS all ${htmlFiles.length} pages have title, description, stylesheet, nav shell and main landmark`);
} catch (err) {
  failures += 1;
  results.push(`FAIL page metadata: ${err.message}`);
}

console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) process.exitCode = 1;

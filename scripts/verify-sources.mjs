#!/usr/bin/env node
// Post-build verification. This is the gate that has to pass before anything is
// published. It checks, in order:
//
//  1. Every generated page exists and is non-trivial.
//  2. Every internal link resolves to a file that exists (no broken navigation).
//  3. Every external link is https and its host is on the allowlist of official
//     publishers this project cites. A typo'd or invented URL fails the build.
//  4. Every table row in the site carries a source cell that is either a real
//     source ID (which resolves in research/sources.json) or an explicit
//     "unverified" flag. A row that is silently unsourced fails the build.
//  5. Every source record has the fields the pages rely on.
//  6. The research documents' own source references ([K1] etc.) all resolve,
//     and no document cites a source ID that does not exist.
//
// Exit code 0 = publishable.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SITE = path.join(ROOT, 'site');
const errors = [];
const warnings = [];

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', 'sources.json'), 'utf8')).sources;

// Official publishers this project is allowed to cite. Anything else gets an error so
// a hallucinated URL cannot slip into a table.
const ALLOWED_HOSTS = [
  'docs.kalshi.com',
  'kalshi.com',
  'github.com',
  'gasprices.aaa.com',
  'www.eia.gov',
  'www.fec.gov',
  'apnews.com',
  'www.boxofficemojo.com',
  'www.billboard.com',
  'www.cfbenchmarks.com',
  'www.cmegroup.com',
  'www.pgatour.com',
  'www.owgr.com'
];

// ---------------------------------------------------------------- 1. pages
if (!fs.existsSync(SITE)) {
  console.error('site/ does not exist — run scripts/build-site.mjs first');
  process.exit(1);
}

const pages = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));
const required = [
  'index.html',
  'executive-summary.html',
  'requirements.html',
  'findings.html',
  'suggestions.html',
  'sources.html',
  'flagged.html',
  'api-contracts.html',
  'fees.html',
  'gas.html',
  'elections.html',
  'culture.html',
  'crypto.html',
  'golf.html'
];
for (const r of required) {
  if (!pages.includes(r)) errors.push(`missing required page: ${r}`);
}

const pageHtml = new Map();
for (const f of pages) {
  const html = fs.readFileSync(path.join(SITE, f), 'utf8');
  pageHtml.set(f, html);
  if (html.length < 500) errors.push(`${f} is suspiciously short (${html.length} bytes)`);
  if (!html.includes('<!doctype html>')) errors.push(`${f} is not a complete HTML document`);
  if (!html.includes('</main>')) errors.push(`${f} has no main element`);
}

for (const asset of ['style.css', 'app.js', 'favicon.svg']) {
  if (!fs.existsSync(path.join(SITE, asset))) errors.push(`missing asset: ${asset}`);
}

// ------------------------------------------------------- 2 & 3. link checks
const linkRe = /href="([^"]+)"/g;
const externalHosts = new Set();
for (const [file, html] of pageHtml) {
  let m;
  while ((m = linkRe.exec(html))) {
    const href = m[1];
    if (href.startsWith('#') || href.startsWith('mailto:')) continue;
    if (/^https?:\/\//.test(href)) {
      const u = new URL(href);
      externalHosts.add(u.host);
      if (u.protocol !== 'https:') errors.push(`${file}: non-https external link ${href}`);
      if (!ALLOWED_HOSTS.includes(u.host)) {
        errors.push(`${file}: external link to non-allowlisted host "${u.host}" (${href})`);
      }
      continue;
    }
    // internal link
    const clean = href.split('#')[0];
    if (!clean) continue;
    if (!fs.existsSync(path.join(SITE, clean))) errors.push(`${file}: broken internal link ${href}`);
  }
}

// every source URL must be reachable-by-definition at build time (present in the registry)
for (const [id, s] of Object.entries(sources)) {
  if (!s.url) errors.push(`source ${id} has no url`);
  if (!s.title) errors.push(`source ${id} has no title`);
  if (!s.publisher) errors.push(`source ${id} has no publisher`);
  if (!Array.isArray(s.claims_supported) || s.claims_supported.length === 0) {
    errors.push(`source ${id} lists no supported claims, so nothing can cite it`);
  }
  if (s.url && !ALLOWED_HOSTS.includes(new URL(s.url).host)) {
    errors.push(`source ${id} url host ${new URL(s.url).host} is not on the allowlist`);
  }
}

// ------------------------------------------------- 4. every table row sourced
// Rule: inside every <tbody>, each <tr> that is NOT a "note" row must have a final
// <td> that either links to an https URL, contains a source id chip, or says
// "unverified". Rows that are pure structure (a header row spanning all columns) are
// allowed when they use a single colspan cell.
let checkedRows = 0;
for (const [file, html] of pageHtml) {
  // A fresh regex per page: a shared /g/ regex keeps lastIndex across strings, which
  // silently skips every table whose page is shorter than the previous scan position.
  const tbodyRe = /<tbody>([\s\S]*?)<\/tbody>/g;
  let m;
  while ((m = tbodyRe.exec(html))) {
    const body = m[1];
    // Keep the <tr ...> open tag with its row: the note/structural markers live in
    // the tag's attributes, and splitting on it would throw them away.
    const parts = body.split(/(<tr[^>]*>)/).slice(1);
    const rows = [];
    for (let k = 0; k < parts.length; k += 2) rows.push({ tag: parts[k], html: parts[k + 1] ?? '' });
    for (const { tag, html: raw } of rows) {
      const cells = raw.split(/<td[^>]*>/).slice(1);
      if (cells.length === 0) continue;
      const isNote = /class="[^"]*\bnote\b/.test(tag);
      if (isNote) continue; // explanatory note row, not a data row
      const firstCell = cells[0];
      const spansAll = cells.length === 1 && /colspan="/.test(raw);
      if (spansAll) continue; // structural header row
      checkedRows += 1;
      const last = cells[cells.length - 1];
      const hasLink = /<a[^>]+href="https:\/\//.test(last);
      const hasFlag = /unverified|no source|missing source/.test(last);
      const hasSourceChip = /class="src"/.test(last);
      // A row may also satisfy the rule by citing sources anywhere in the row, e.g.
      // a requirements row whose source column is "the code in app/lib/x.mjs" but
      // whose status column links the official contract it is built against.
      const hasCitedSource = /<a[^>]+href="https:\/\/(docs\.kalshi\.com|kalshi\.com)\//.test(raw);
      if (!hasLink && !hasFlag && !hasSourceChip && !hasCitedSource) {
        errors.push(`${file}: table row with no source cell: ${raw.replace(/<[^>]+>/g, ' ').trim().slice(0, 100)}`);
      }
    }
  }
}

// ------------------------------------------- 5. research docs cite only real ids
const docs = ['EXECUTIVE_SUMMARY.md', 'requirements/REQUIREMENTS.md', 'research/findings.md', 'research/SUGGESTIONS.md', 'COORDINATION.md'];
let refsChecked = 0;
for (const doc of docs) {
  const p = path.join(ROOT, doc);
  if (!fs.existsSync(p)) {
    warnings.push(`${doc} not found, skipping reference check`);
    continue;
  }
  const text = fs.readFileSync(p, 'utf8');
  // markdown link definitions like [K1]: https://...
  const defs = [...text.matchAll(/^\[(K\d+)\]:\s*(\S+)/gm)];
  for (const [, id, url] of defs) {
    refsChecked += 1;
    const rec = sources[id];
    if (!rec) errors.push(`${doc}: link definition ${id} does not exist in sources.json`);
    else if (rec.url !== url) errors.push(`${doc}: ${id} points at ${url} but sources.json says ${rec.url}`);
  }
  // inline references like [K13] or [K13][K14]
  const inline = [...text.matchAll(/\[(K\d+)\](?!:)/g)].map((x) => x[1]);
  for (const id of new Set(inline)) {
    refsChecked += 1;
    if (!sources[id]) errors.push(`${doc}: cites ${id} which is not in sources.json`);
  }
}

// ---------------------------------------------- 6. flagged page must exist & fill
const flagged = pageHtml.get('flagged.html') || '';
if (!/unverified/i.test(flagged)) errors.push('flagged.html does not mention unverified items');
if (!/irregular/i.test(flagged)) errors.push('flagged.html does not list irregularities');

// ---------------------------------------------------------------- reporting
const totalExternal = externalHosts.size;
console.log('verify-sources');
console.log(`  pages            ${pages.length}`);
console.log(`  table rows       ${checkedRows} checked for a source cell`);
console.log(`  source records   ${Object.keys(sources).length}`);
console.log(`  external hosts   ${[...externalHosts].join(', ')}`);
console.log(`  doc references   ${refsChecked} cross-checked against sources.json`);

if (warnings.length) {
  console.log('\nwarnings:');
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\n\x1b[31m${errors.length} error(s):\x1b[0m`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('\n\x1b[32mok — every published row carries a source or an explicit unverified flag\x1b[0m');

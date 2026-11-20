/**
 * Static link checker for the published site in /docs.
 *
 * Checks, with zero dependencies:
 *   - every local href/src resolves to a file that exists (or an in-page anchor target)
 *   - every #anchor referenced in a link exists as an id on the target page
 *   - every JS module imported by a page resolves
 *   - every page that loads a page-script has the DOM ids that script writes into
 *   - no leftover placeholder markers
 *
 * Exit code is 1 if anything fails, so it is safe to run in CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

const errors = [];
const warnings = [];
const checked = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DOCS);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const pageScripts = files.filter((f) => f.includes(path.join('assets', 'pages')) && f.endsWith('.js'));

const idsByPage = new Map();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  idsByPage.set(path.relative(DOCS, file), { ids, html });
}

// ---- local links & anchors -------------------------------------------------
for (const [rel, { ids, html }] of idsByPage) {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    // External schemes are not local files; data: URIs are inline assets.
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(ref)) continue;
    if (ref.startsWith('#')) {
      const anchor = ref.slice(1);
      if (anchor && !ids.has(anchor)) errors.push(`${rel}: in-page anchor #${anchor} has no matching id`);
      continue;
    }
    const [targetPart, anchorPart] = ref.split('#');
    const targetPath = path.resolve(path.dirname(path.join(DOCS, rel)), targetPart);
    checked.push(`${rel} -> ${targetPart}`);
    if (!fs.existsSync(targetPath)) {
      errors.push(`${rel}: broken link to ${targetPart}`);
      continue;
    }
    if (anchorPart) {
      const targetRel = path.relative(DOCS, targetPath);
      const targetIds = idsByPage.get(targetRel)?.ids;
      if (targetIds && !targetIds.has(anchorPart)) {
        errors.push(`${rel}: link to ${targetPart}#${anchorPart} but #${anchorPart} does not exist there`);
      }
    }
  }
}

// ---- module imports resolve -----------------------------------------------
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) errors.push(`${path.relative(DOCS, file)}: import not found: ${m[1]}`);
  }
}

// ---- page scripts must have the ids they target ---------------------------
const idLookups = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const script of pageScripts) {
  const src = fs.readFileSync(script, 'utf8');
  const wanted = new Set([...src.matchAll(idLookups)].map((m) => m[1]));
  // The HTML file that imports this script must contain those ids.
  const normalized = script.split(path.sep).join('/');
  const host = htmlFiles.find((f) => fs.readFileSync(f, 'utf8').includes(normalized.replace(/^.*docs\//, '')));
  if (!host) {
    warnings.push(`${normalized}: no HTML page appears to load this script`);
    continue;
  }
  const hostIds = idsByPage.get(path.relative(DOCS, host)).ids;
  for (const id of wanted) {
    if (!hostIds.has(id)) errors.push(`${path.relative(DOCS, host)}: script ${path.basename(script)} writes to #${id} but the page has no such element`);
  }
}

// ---- placeholders & obvious mistakes --------------------------------------
for (const file of files.filter((f) => f.endsWith('.html') || f.endsWith('.js'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const marker of ['PLACEHOLDER_NEVER', 'TODO', 'FIXME', 'lorem ipsum', 'undefined</']) {
    if (text.includes(marker)) errors.push(`${path.relative(DOCS, file)}: contains placeholder marker "${marker}"`);
  }
}

// ---- report ----------------------------------------------------------------
console.log(`Checked ${htmlFiles.length} HTML pages and ${files.filter((f) => f.endsWith('.js')).length} JS files.`);
console.log(`Resolved ${checked.length} local references.`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exitCode = 1;
} else {
  console.log('\nAll local links, anchors, imports and DOM targets resolve.');
}

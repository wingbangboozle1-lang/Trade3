// Claims test: things the repo ASSERTS about itself must be true of the tree.
//
// Every check below was added by session arena/5d2508a7-trade3 after finding published
// claims that the code did not support (requirements/REQUIREMENTS.md R7/R10/R17/R18/R20/R21,
// docs/dashboard-site REQUIREMENTS R*, and the docs/verification.html "matches" column).
// A failing check here means a published sentence outgrew the code again.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    const note = fn();
    passed += 1;
    console.log(`PASS ${name}${typeof note === 'string' ? ` — ${note}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', '__pycache__', 'verify-cache'].includes(entry)) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const codeFiles = walk(path.join(ROOT, 'server'))
  .concat(walk(path.join(ROOT, 'docs', 'assets')), walk(path.join(ROOT, 'app')))
  .concat([path.join(ROOT, 'kalshi_client.py'), path.join(ROOT, 'strategies.py'), path.join(ROOT, 'backtest.py')]);
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

check('no code reads a Kalshi dollar_volume FIELD (R7 claimed it once)', () => {
  // kalshi_client.dollar_volume() is this repo's own volume x price proxy — allowed.
  // A response FIELD cannot exist: the API returns no dollar-volume value.
  const readsField = /\.dollar_volume\b/.test(code);
  if (readsField) throw new Error('a response dollar_volume field is read; the API does not return one');
  return 'only the local volume x price helper exists';
});

check('no WebSocket client is implemented (WS URLs are configuration, not a feed)', () => {
  if (/new WebSocket\s*\(/.test(code)) throw new Error('a WebSocket client exists — update the Requirements page');
  return 'polling only, as published';
});

check('no crossing-cost calculator is presented as a feature (R18)', () => {
  if (/costToCross|crossCost/i.test(code)) throw new Error('crossing-cost code found — update R18');
  return 'depth ladder only';
});

check('no sparkline / density-strip / P&L-curve code exists (R20)', () => {
  for (const word of ['sparkline', 'densityStrip', 'pnlCurve']) {
    if (new RegExp(word, 'i').test(code)) throw new Error(`${word} found — update R20`);
  }
  return 'none of the four claimed extras exist';
});

check('no external news feed is configured as a cause of a move (R21)', () => {
  const appCode = walk(path.join(ROOT, 'docs', 'assets')).map((f) => readFileSync(f, 'utf8')).join('\n');
  if (/newsfeed|newsFeed|rssFeed/i.test(appCode)) throw new Error('news feed config found — update R21');
  return 'exchange record only';
});

check('live orders stay behind KALSHI_ALLOW_ORDERS=1', () => {
  const py = readFileSync(path.join(ROOT, 'kalshi_client.py'), 'utf8');
  if (!/KALSHI_ALLOW_ORDERS/.test(py)) throw new Error('python order path lost its opt-in guard');
  const js = readFileSync(path.join(ROOT, 'server', 'kalshi.js'), 'utf8');
  if (!/portfolio\/events\/orders/.test(js)) throw new Error('JS order path no longer uses the documented V2 route');
  return 'guarded in Python, V2 route in JS';
});

check('the verification page does not claim a comparison it did not run', () => {
  const js = readFileSync(path.join(ROOT, 'docs', 'assets', 'verification.js'), 'utf8');
  if (/>matches</.test(js) && !/verbatim · re-checked/.test(js)) throw new Error('verification.js still prints an unearned "matches" pill');
  if (!/not re-checked since/.test(js)) throw new Error('verification.js lost the honest fallback label');
  return 'provenance labels only';
});

check('the data-integrity test is wired into npm test', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const suite of ['data-verify.test.mjs', 'claims.test.mjs']) {
    if (!pkg.scripts.test.includes(suite)) throw new Error(`npm test no longer runs ${suite}`);
  }
  return pkg.scripts.test;
});

check('every requirement row that is corrected says so in the row', () => {
  const md = readFileSync(path.join(ROOT, 'requirements', 'REQUIREMENTS.md'), 'utf8');
  const corrected = ['R7', 'R10', 'R17', 'R18', 'R20', 'R21'];
  for (const id of corrected) {
    const row = md.split('\n').find((l) => l.startsWith(`| ${id} |`)) || '';
    if (!/correction 2026-11-21/i.test(row)) throw new Error(`${id} lost its correction note`);
  }
  return `${corrected.length} rows carry the correction`;
});


check('Build B: a re-verified row is never labelled a blanket "match" without a per-row outcome', () => {
  const dataJs = readFileSync(path.join(ROOT, 'docs', 'dashboard-site', 'assets', 'data.js'), 'utf8');
  const block = dataJs.slice(dataJs.indexOf('export const REVERIFIED'), dataJs.indexOf('export const DEMO_REST'));
  const rows = block.match(/result: '([a-z-]+)'/g) || [];
  if (rows.length < 10) throw new Error(`only ${rows.length} per-row outcomes recorded`);
  if (!/result: 'not-checked'/.test(block)) throw new Error('expired strikes must be recorded as not-checked, not match');
  if (!/result: 'corrected'/.test(block)) throw new Error('the corrected rows must say so');
  return `${rows.length} rows carry an explicit outcome`;
});

check('Build B: no market row publishes a null volume where the API returns a number', () => {
  const dataJs = readFileSync(path.join(ROOT, 'docs', 'dashboard-site', 'assets', 'data.js'), 'utf8');
  const block = dataJs.slice(dataJs.indexOf('export const MARKETS'), dataJs.indexOf('export const EMPTY_TOPIC_NOTES'));
  if (/volume: null/.test(block)) throw new Error('a market row still has volume: null');
  return 'no null volumes';
});

check('the snapshot never claims to be live data', () => {
  const snap = JSON.parse(readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
  if (!/not live/i.test(snap.note || '')) throw new Error('snapshot note lost its "Not live" wording');
  if (!snap.recheck || !snap.recheck.verified || !snap.recheck.pending_recheck) throw new Error('snapshot lost its recheck block');
  const pending = snap.recheck.pending_recheck.tickers.length;
  const verified = Object.keys(snap.recheck.verified).length;
  return `${verified} re-read, ${pending} explicitly pending`;
});


check('Build B states golf settlement sources in the API order', () => {
  const dataJs = readFileSync(path.join(ROOT, 'docs', 'dashboard-site', 'assets', 'data.js'), 'utf8');
  const bad = /settle(ment)?Source(Name)?: 'ESPN, Fox Sports/;
  if (bad.test(dataJs)) throw new Error('golf settlement sources are not in the record order (Fox Sports, ESPN, the Governing League)');
  const good = (dataJs.match(/Fox Sports, ESPN, the Governing League/g) || []).length;
  if (good < 3) throw new Error(`only ${good} rows carry the record order; expected market rows + series row`);
  return `${good} rows in record order`;
});

console.log(`\n${passed}/${passed + failed} claim checks passed`);
process.exit(failed ? 1 : 0);

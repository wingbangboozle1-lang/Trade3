// Data-integrity regression test: the published series table must match an explicit,
// machine-checkable settlement rule, and no published row may paraphrase an
// official settlement source. Run with:  node tests/data-verify.test.mjs
//
// This encodes the review findings of session arena/5d2508a7-trade3 (2026-11-21):
// eight published settlement values were NOT verbatim copies of the official
// GET /series/{ticker} records (golf rows reordered them, KXBTC2025100 appended a
// note, KXELECTUKRAINE published a sentence, KXLINKPERP/KXSOLPERP published an
// explanation where the API returns null). All are now blank-and-flagged or copied
// exactly. This test stops the pattern from coming back.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'docs/data/series.json'), 'utf8'));

let failed = 0;
let passed = 0;
function check(name, fn) {
  try {
    const msg = fn();
    if (msg === false) throw new Error('assertion returned false');
    passed += 1;
    console.log(`PASS ${name}${typeof msg === 'string' ? ` — ${msg}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}

const rows = [];
for (const [topicId, topic] of Object.entries(DATA.topics)) {
  for (const row of topic.series) rows.push({ topicId, row });
}

check('every topic declares its rule and source', () => {
  for (const [id, t] of Object.entries(DATA.topics)) {
    for (const key of ['label', 'kalshi_category', 'series']) {
      if (!(key in t)) throw new Error(`${id} lacks ${key}`);
    }
  }
  return `${Object.keys(DATA.topics).length} topics`;
});

check('39 rows, one per published series', () => rows.length === 39 && `${rows.length} rows`);

check('settlement_rule is published and says "verbatim"', () => {
  const rule = DATA.settlement_rule || '';
  if (!/verbatim/i.test(rule)) throw new Error('series.json lost its settlement_rule text');
  if (!/settlement_sources\[0\]/.test(rule)) throw new Error('rule no longer names settlement_sources[0]');
  return 'rule present';
});

check('no settlement value contains a parenthetical aside (the old paraphrase shape)', () => {
  const bad = rows.filter(({ row }) => /\(also |\(URL exactly|^See series record|^None listed by Kalshi/.test(row.settlement || ''));
  if (bad.length) throw new Error(bad.map(({ row }) => `${row.ticker}: ${row.settlement}`).join('; '));
  return 'none';
});

check('a published settlement is always "NAME — URL" (verbatim shape) or empty', () => {
  const bad = rows.filter(({ row }) => row.settlement && !/^.+ — https?:\/\//.test(row.settlement));
  if (bad.length) throw new Error(bad.map(({ row }) => `${row.ticker}: ${row.settlement}`).join('; '));
  return 'all well-formed';
});

check('blank settlement rows carry an explicit policy or note', () => {
  const bad = rows.filter(({ row }) => !row.settlement && !row.settlement_policy && !row.settlement_note);
  if (bad.length) throw new Error(`${bad.map(({ row }) => row.ticker).join(', ')} blank without a reason`);
  const blanks = rows.filter(({ row }) => !row.settlement).map(({ row }) => row.ticker);
  return `${blanks.length} blank on purpose: ${blanks.join(', ')}`;
});

check('golf settlement values start with the API\'s first source (Fox Sports / NBC Sports / ESPN)', () => {
  const golf = rows.filter(({ topicId }) => topicId === 'golf');
  for (const { row } of golf) {
    if (!/^(Fox Sports|NBC Sports|ESPN) — https?:\/\//.test(row.settlement)) {
      throw new Error(`${row.ticker}: first source is not the record's settlement_sources[0] (${row.settlement})`);
    }
  }
  return `${golf.length} golf rows`;
});

check('every row still points at its official API record', () => {
  const bad = rows.filter(({ row }) => !String(row.source || '').startsWith('https://external-api.'));
  if (bad.length) throw new Error(bad.map(({ row }) => row.ticker).join(', '));
  return `${rows.length} official source URLs`;
});

check('no published row claims a category its topic does not declare', () => {
  for (const [id, t] of Object.entries(DATA.topics)) {
    const allowed = new Set([t.kalshi_category, t.kalshi_category_superset].filter(Boolean));
    for (const row of t.series) {
      if (!allowed.has(row.category)) throw new Error(`${row.ticker}: ${row.category} not in ${[...allowed].join('/')}`);
    }
  }
  return 'all inside their topic';
});

console.log(`\n${passed}/${passed + failed} data-integrity checks passed`);
process.exit(failed ? 1 : 0);

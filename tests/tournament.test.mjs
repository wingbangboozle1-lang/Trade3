/**
 * Tests for the shadow strategy tournament.
 *
 * The rules under test are the exchange's, not mine:
 *   - buying YES pays the YES ask, buying NO pays 1 - best YES bid
 *     (https://docs.kalshi.com/api-reference/market/get-market-orderbook);
 *   - a winning contract pays $1.00, a losing one pays nothing
 *     (https://docs.kalshi.com/getting_started/market_settlement);
 *   - nothing settles until a result is published.
 *
 * Run: node tests/tournament.test.mjs
 */

import assert from 'node:assert/strict';
import { StrategyTournament, entryPriceCents, SHADOW_STRATEGIES } from '../server/tournament.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); }
}

const quote = { yesBidDollars: '0.4000', yesAskDollars: '0.4200' };

test('entry price: YES pays the ask, NO pays 1 - best YES bid', () => {
  assert.equal(entryPriceCents({ side: 'yes', ...quote }), 42, 'YES buys at $0.42');
  assert.equal(entryPriceCents({ side: 'no', ...quote }), 60, 'NO buys at 1 - 0.40 = $0.60');
});

test('entry price refuses an unusable quote instead of guessing', () => {
  assert.equal(entryPriceCents({ side: 'yes', yesBidDollars: '0.4', yesAskDollars: null }), null);
  assert.equal(entryPriceCents({ side: 'no', yesBidDollars: null, yesAskDollars: '0.42' }), null);
  assert.equal(entryPriceCents({ side: 'yes', yesBidDollars: '0.4', yesAskDollars: '1.0000' }), null,
    'a $1.00 ask is not a tradeable price');
  assert.equal(entryPriceCents({ side: 'no', yesBidDollars: '0.0000', yesAskDollars: '0.02' }), null,
    '1 - 0.00 = $1.00 is not tradeable');
});

test('one swing is offered to every strategy with the same quote', () => {
  const t = new StrategyTournament();
  const opened = t.onSwing({
    swing: { ticker: 'A-1', title: 'Test', topicId: 'gas', from: 0.30, to: 0.42, delta: 0.12, at: 1000 },
    quote,
  });
  // Momentum follows (YES), mean-reversion fades (NO). Threshold-break sees no
  // round level crossed by 0.30 -> 0.42. Fade-extreme sees no extreme band.
  assert.equal(opened.length, 2);
  assert.deepEqual(opened.map((p) => p.strategy).sort(), ['mean_revert', 'momentum']);
  const mom = opened.find((p) => p.strategy === 'momentum');
  assert.equal(mom.side, 'yes');
  assert.equal(mom.entryCents, 42);
  assert.equal(mom.count, Math.floor(1000 / 42), 'whole contracts only');
  assert.equal(mom.costCents, mom.count * 42);
});

test('strategies that decline record a skip with the reason', () => {
  const t = new StrategyTournament();
  t.onSwing({ swing: { ticker: 'A-1', from: 0.30, to: 0.42, delta: 0.12, at: 1 }, quote });
  const r = t.report();
  const thr = r.strategies.find((s) => s.strategy === 'threshold_break');
  const ext = r.strategies.find((s) => s.strategy === 'fade_extreme');
  assert.equal(thr.opened, 0);
  assert.equal(thr.skips, 1);
  assert.match(Object.keys(thr.skipReasons)[0], /round level/);
  assert.match(Object.keys(ext.skipReasons)[0], /extreme band/);
});

test('threshold break fires when a round level is crossed', () => {
  const t = new StrategyTournament();
  const opened = t.onSwing({
    swing: { ticker: 'B-2', from: 0.45, to: 0.56, delta: 0.11, at: 2 },
    quote: { yesBidDollars: '0.55', yesAskDollars: '0.56' },
  });
  const thr = opened.find((p) => p.strategy === 'threshold_break');
  assert.ok(thr, '0.45 -> 0.56 crosses $0.50, so threshold-break must trade');
  assert.equal(thr.side, 'yes');
});

test('fade extreme fires only outside the $0.15-$0.85 band', () => {
  const t = new StrategyTournament();
  const inside = t.onSwing({ swing: { ticker: 'C', from: 0.5, to: 0.62, delta: 0.12, at: 3 }, quote });
  assert.equal(inside.some((p) => p.strategy === 'fade_extreme'), false);
  const outside = t.onSwing({
    swing: { ticker: 'D', from: 0.78, to: 0.89, delta: 0.11, at: 4 },
    quote: { yesBidDollars: '0.88', yesAskDollars: '0.89' },
  });
  const fade = outside.find((p) => p.strategy === 'fade_extreme');
  assert.ok(fade, 'landing above $0.85 must trigger the fade');
  assert.equal(fade.side, 'no');
});

test('nothing settles until a result is published, and only the right market settles', () => {
  const t = new StrategyTournament();
  t.onSwing({ swing: { ticker: 'A-1', from: 0.3, to: 0.42, delta: 0.12, at: 1 }, quote });
  t.onSwing({ swing: { ticker: 'Z-9', from: 0.3, to: 0.42, delta: 0.12, at: 2 }, quote });
  assert.equal(t.report().openPositions, 4);
  assert.equal(t.settle({ ticker: 'A-1', result: '' }).length, 0, 'an empty result settles nothing');
  assert.equal(t.settle({ ticker: 'A-1', result: 'maybe' }).length, 0, 'an unknown result settles nothing');
  const settled = t.settle({ ticker: 'A-1', result: 'yes' });
  assert.equal(settled.length, 2);
  assert.equal(t.report().openPositions, 2, 'the other market stays open');
});

test('a winning contract pays $1.00 and a losing one pays nothing', () => {
  const t = new StrategyTournament();
  t.onSwing({ swing: { ticker: 'A-1', from: 0.3, to: 0.42, delta: 0.12, at: 1 }, quote });
  t.settle({ ticker: 'A-1', result: 'yes' });
  const r = t.report();
  const mom = r.strategies.find((s) => s.strategy === 'momentum');
  const mr = r.strategies.find((s) => s.strategy === 'mean_revert');

  // Momentum bought YES at 42c: 23 contracts, cost 966c, payout 2300c.
  assert.equal(mom.wins, 1);
  assert.equal(mom.losses, 0);
  assert.equal(mom.pnlCents, 23 * 100 - 23 * 42);
  assert.equal(mom.hitRate, 1);

  // Mean reversion bought NO at 60c: 16 contracts, cost 960c, YES won so payout 0.
  assert.equal(mr.losses, 1);
  assert.equal(mr.wins, 0);
  assert.equal(mr.pnlCents, -16 * 60);
  assert.equal(mr.hitRate, 0);
});

test('a strategy with no settled positions reports null P&L, never zero', () => {
  const t = new StrategyTournament();
  const r = t.report();
  for (const s of r.strategies) {
    assert.equal(s.pnlCents, null, `${s.strategy} must not claim $0.00 before it has traded`);
    assert.equal(s.hitRate, null, `${s.strategy} must not claim a 0% or 100% hit rate`);
  }
  assert.equal(r.leader, null, 'there is no leader before anything settles');
  assert.deepEqual(r.ranking, []);
});

test('the ranking only orders strategies that have settled something', () => {
  const t = new StrategyTournament();
  t.onSwing({ swing: { ticker: 'A-1', from: 0.3, to: 0.42, delta: 0.12, at: 1 }, quote });
  t.settle({ ticker: 'A-1', result: 'yes' });
  const r = t.report();
  assert.equal(r.leader, 'momentum');
  assert.equal(r.ranking[0], 'momentum');
  assert.ok(r.ranking.includes('mean_revert'));
  assert.equal(r.ranking.includes('threshold_break'), false,
    'a strategy that traded nothing is not ranked against the others');
});

test('results are categorised by topic, side and swing direction', () => {
  const t = new StrategyTournament();
  t.onSwing({ swing: { ticker: 'G-1', topicId: 'gas', from: 0.3, to: 0.42, delta: 0.12, at: 1 }, quote });
  t.onSwing({ swing: { ticker: 'C-1', topicId: 'crypto', from: 0.6, to: 0.48, delta: -0.12, at: 2 }, quote });
  const mom = t.report().strategies.find((s) => s.strategy === 'momentum');
  assert.deepEqual(mom.byTopic, { gas: 1, crypto: 1 });
  assert.deepEqual(mom.bySide, { yes: 1, no: 1 });
  assert.deepEqual(mom.bySwingDirection, { up: 1, down: 1 });
});

test('the report states plainly that it is simulated and fee-free', () => {
  const r = new StrategyTournament().report();
  assert.match(r.note, /Simulated only/);
  assert.match(r.note, /No fees/);
  assert.equal(r.settlementDocs, 'https://docs.kalshi.com/getting_started/market_settlement');
  assert.equal(r.pricingDocs, 'https://docs.kalshi.com/api-reference/market/get-market-orderbook');
});

test('all four strategies from the paper engine are covered', () => {
  assert.deepEqual(SHADOW_STRATEGIES.map((s) => s.id).sort(),
    ['fade_extreme', 'mean_revert', 'momentum', 'threshold_break']);
  for (const s of SHADOW_STRATEGIES) {
    assert.ok(s.label && s.thesis && s.rule, `${s.id} needs a label, thesis and rule`);
    assert.equal(typeof s.decide, 'function');
  }
});

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) process.exit(1);

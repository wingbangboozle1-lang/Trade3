// Categorisation and ranking. The requirement is "analyze the results of the trades
// and categorize trades and create strategies based on the type of trade", so these
// tests assert the categories exist, are computed from real trades, and refuse to
// rank a sample that is too small.

import { suite, test, assert, eq, near } from './harness.mjs';
import { analyze, categorize, rankStrategies, maxDrawdown, reconcile } from '../app/lib/portfolio.mjs';

const T = 1_000_000;

function trade(over = {}) {
  return {
    strategyId: 'maker_spread',
    topic: 'crypto',
    side: 'yes',
    contracts: 10,
    entryTicks: 400_000,
    exitTicks: 500_000,
    entryTs: 1_700_000_000_000,
    exitTs: 1_700_000_180_000,
    holdMs: 180_000, // 3 min: unambiguously inside the 1-5m bucket
    feesTicks: 10_000,
    pnlTicks: 90_000,
    exitReason: 'take_profit',
    outcomeKind: 'exit',
    filledAs: 'maker',
    ...over
  };
}

suite('analytics — categories and rankings', () => {
  test('trades are bucketed by strategy, topic, side, price, hold and exit', () => {
    const a = analyze([trade(), trade({ strategyId: 'taker_fade', topic: 'golf', side: 'no', exitReason: 'stop', pnlTicks: -50_000 })]);
    eq(Object.keys(a.byStrategy).length, 2);
    eq(Object.keys(a.byTopic).length, 2);
    eq(Object.keys(a.bySide).length, 2);
    eq(Object.keys(a.byExitReason).length, 2);
    assert(a.byPriceBucket['25-50c'], 'price bucket bucket');
    assert(a.byHoldBucket['1-5m'], 'hold bucket');
  });

  test('summaries are simple arithmetic on the recorded numbers', () => {
    const a = analyze([trade({ pnlTicks: 100 }), trade({ pnlTicks: -40 }), trade({ pnlTicks: 20 })]);
    eq(a.overall.n, 3);
    eq(a.overall.pnlTicks, 80);
    eq(a.overall.wins, 2);
    eq(a.overall.losses, 1);
    near(a.overall.winRate, 2 / 3, 1e-9);
    eq(a.overall.avgPnlTicks, Math.round(80 / 3));
  });

  test('profit factor divides gross wins by gross losses', () => {
    const a = analyze([trade({ pnlTicks: 300 }), trade({ pnlTicks: -100 })]);
    eq(a.overall.profitFactor, 3);
  });

  test('profit factor is null, not infinity, when nothing lost', () => {
    const a = analyze([trade({ pnlTicks: 300 })]);
    eq(a.overall.profitFactor, null);
  });

  test('a strategy with too few trades is reported but not ranked', () => {
    const trades = Array.from({ length: 5 }, () => trade());
    const ranked = rankStrategies(trades, { minTrades: 10 });
    eq(ranked[0].ranked, false);
    eq(ranked[0].score, null);
  });

  test('a strategy with enough trades is ranked by EV per contract', () => {
    const good = Array.from({ length: 12 }, () => trade({ strategyId: 'good', pnlTicks: 50_000 }));
    const bad = Array.from({ length: 12 }, () => trade({ strategyId: 'bad', pnlTicks: -50_000 }));
    const ranked = rankStrategies([...good, ...bad], { minTrades: 10 });
    eq(ranked[0].id, 'good');
    assert(ranked[0].score > ranked[1].score);
  });

  test('max drawdown follows the realized curve in exit order', () => {
    const trades = [
      trade({ exitTs: 3, pnlTicks: 100 }),
      trade({ exitTs: 1, pnlTicks: 300 }),
      trade({ exitTs: 2, pnlTicks: -400 })
    ];
    // ordered by exit: +300, -400 (cum -100), +100 (cum 0) => drawdown 400 from peak 300
    eq(maxDrawdown(trades), 400);
  });

  test('an empty ledger produces zeros, never NaN', () => {
    const a = analyze([]);
    eq(a.overall.n, 0);
    eq(a.overall.winRate, null);
    eq(a.overall.evPerContractTicks, null);
    eq(a.overall.maxDrawdownTicks, 0);
  });

  test('the cross-tab keeps strategies and topics separate', () => {
    const a = analyze([trade({ strategyId: 's1', topic: 'gas' }), trade({ strategyId: 's1', topic: 'crypto' }), trade({ strategyId: 's2', topic: 'gas' })]);
    eq(a.strategyByTopic.s1.gas.n, 1);
    eq(a.strategyByTopic.s1.crypto.n, 1);
    eq(a.strategyByTopic.s2.gas.n, 1);
    assert(!a.strategyByTopic.s2.crypto, 'no invented cross-tab cell');
  });

  test('categorize() emits every category the UI groups by', () => {
    const c = categorize(trade());
    for (const k of ['strategy', 'topic', 'side', 'priceBucket', 'holdBucket', 'exitReason', 'outcomeKind', 'taker']) {
      assert(k in c, `missing category ${k}`);
    }
  });

  test('paper and live figures are shown side by side and never summed', () => {
    const r = reconcile({
      paper: { cashTicks: 500 * T, equityTicks: 600 * T, realizedTicks: 100 * T },
      live: { connected: true, balanceTicks: 1234 * T, portfolioValueTicks: 77 * T }
    });
    eq(r.rows.length, 3);
    assert(r.note.includes('not comparable'), 'the caveat travels with the numbers');
    eq(r.liveConnected, true);
    const cashRow = r.rows.find((x) => x.label === 'Cash');
    eq(cashRow.paperTicks, 500 * T, 'paper cash is untouched by live values');
    eq(cashRow.liveTicks, 1234 * T, 'live cash is untouched by paper values');
  });
});

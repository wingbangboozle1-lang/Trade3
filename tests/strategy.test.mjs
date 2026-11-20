// The model's honesty properties, asserted. The most important test here is that a
// taker fade has NEGATIVE expected value at the mid — if that ever passes positive,
// the math is wrong, not the market.

import { suite, test, assert, eq } from './harness.mjs';
import { scoreAlert, decideEntries, depthSummary, impliedAsk, STRATEGIES } from '../app/lib/strategy.mjs';

const T = 1_000_000;
const now = 1_800_000_000_000;
const model = {
  minEdge: 0.005,
  minLiquidity: 25,
  maxSpread: 0.08,
  maxMinutesToClose: 43_200,
  minReturnBps: 150,
  minShockOverSpread: 2,
  maxRiskPerTradeTicks: 50_000_000
};

function book({ yesBid = 400_000, noBid = 590_000, size = 500 } = {}) {
  return depthSummary([{ ticks: yesBid, count: size }], [{ ticks: noBid, count: size }]);
}

function alert(over = {}) {
  return { direction: 'up', deltaTicks: 140_000, fromTicks: 560_000, toTicks: 700_000, toTs: now, ...over };
}

const market = (over = {}) => ({ closeSec: Math.floor(now / 1000) + 86_400, seriesTicker: 'KXPGA', ...over });

suite('strategy — model honesty', () => {
  test('taker fade at the mid is negative EV because of the spread', () => {
    const s = scoreAlert(alert(), { market: market(), book: book(), model });
    assert(s.taker, 'taker view exists');
    assert(s.taker.evTicks < 0, `taker EV must be negative, got ${s.taker.evTicks}`);
    // half-spread + fee, exactly
    const half = s.taker.midTicks - s.taker.askTicks;
    eq(s.taker.evTicks, half - s.taker.takerFeeTicks, 'EV = mid - ask - fee');
  });

  test('maker view earns the half-spread and can be positive', () => {
    const s = scoreAlert(alert(), { market: market(), book: book(), model });
    assert(s.maker, 'maker view exists');
    assert(s.maker.evTicks > 0, `maker EV should be positive here, got ${s.maker.evTicks}`);
    assert(s.maker.fillProbabilityNote.includes('Fills only if'), 'the fill caveat is attached to the number');
  });

  test('maker edge equals half-spread minus the maker fee', () => {
    const s = scoreAlert(alert(), { market: market(), book: book(), model });
    eq(s.maker.evTicks, s.maker.halfSpreadTicks - s.maker.makerFeeTicks);
  });

  test('maker fee is zero for an unlisted series with the documented default', () => {
    const s = scoreAlert(alert(), { market: market({ seriesTicker: 'UNLISTED' }), book: book(), model });
    eq(s.maker.makerFeeTicks, 0, 'maker multiplier defaults to 0 (K6)');
  });

  test('a listed 1x series pays a real maker fee', () => {
    const s = scoreAlert(alert(), { market: market({ seriesTicker: 'KXAAAGASM' }), book: book(), model });
    assert(s.maker.makerFeeTicks > 0, 'KXAAAGASM has maker multiplier 1');
  });

  test('no promotion without a book', () => {
    const s = scoreAlert(alert(), { market: market(), book: null, model });
    eq(s.promote, false);
    assert(s.reasons.some((r) => r.includes('no two-sided book')));
  });

  test('thin depth blocks promotion', () => {
    const s = scoreAlert(alert(), { market: market(), book: book({ size: 3 }), model });
    eq(s.promote, false);
    assert(s.reasons.some((r) => r.includes('depth')));
  });

  test('a wide spread blocks promotion', () => {
    const b = depthSummary([{ ticks: 400_000, count: 500 }], [{ ticks: 520_000, count: 500 }]); // 20c spread
    const s = scoreAlert(alert(), { market: market(), book: b, model });
    eq(s.promote, false);
    assert(s.reasons.some((r) => r.includes('spread')));
  });

  test('an imminent close blocks promotion', () => {
    const s = scoreAlert(alert(), { market: market({ closeSec: Math.floor(now / 1000) + 30 }), book: book(), model });
    eq(s.promote, false);
    assert(s.reasons.some((r) => r.includes('time to close')));
  });

  test('a move that is small relative to the spread is not signal', () => {
    // 10c move, 8c spread: 10 >= 2*8 is false, so it must not promote
    const b = depthSummary([{ ticks: 420_000, count: 500 }], [{ ticks: 500_000, count: 500 }]);
    const s = scoreAlert(alert({ deltaTicks: 100_000 }), { market: market(), book: b, model });
    eq(s.gates.signalToNoise, false);
    eq(s.promote, false);
  });

  test('a tiny edge in bps does not promote', () => {
    const strict = { ...model, minReturnBps: 100_000 };
    const s = scoreAlert(alert(), { market: market(), book: book(), model: strict });
    eq(s.promote, false);
  });

  test('every promotion carries its inputs for audit', () => {
    const s = scoreAlert(alert(), { market: market(), book: book(), model });
    assert(s.inputs.alertDeltaTicks === 140_000);
    assert(s.inputs.spreadTicks !== null);
    assert(s.inputs.liquidityContracts >= 0);
    assert(typeof s.inputs.minutesToClose === 'number');
  });

  test('implied ask is 1 - opposite best bid (K5)', () => {
    eq(impliedAsk([{ ticks: 300_000, count: 1 }, { ticks: 410_000, count: 1 }]), T - 410_000);
    eq(impliedAsk([]), null);
  });

  test('depth summary uses the last (highest) level as the touch', () => {
    const d = depthSummary(
      [{ ticks: 100_000, count: 5 }, { ticks: 300_000, count: 7 }],
      [{ ticks: 600_000, count: 9 }, { ticks: 650_000, count: 4 }]
    );
    eq(d.bestYesBid, 300_000);
    eq(d.bestNoBid, 650_000);
    eq(d.bestYesAsk, T - 650_000);
    eq(d.spreadTicks, T - 650_000 - 300_000);
  });

  test('coherence fires only inside a complete mutually exclusive event', () => {
    const b = book();
    const incomplete = scoreAlert(alert(), { market: market(), book: b, siblings: { sumYesTicks: 1_200_000, count: 2, complete: false }, model });
    eq(incomplete.coherence, null, 'no coherence view when the set is incomplete');
    const complete = scoreAlert(alert(), { market: market(), book: b, siblings: { sumYesTicks: 1_200_000, count: 2, complete: true }, model });
    assert(complete.coherence, 'coherence view exists');
    eq(complete.coherence.side, 'no', 'overpriced legs => buy NO');
    eq(complete.coherence.perLegEdgeTicks, 100_000, '20c overpriced across 2 legs = 10c/leg');
  });

  test('decideEntries refuses to trade when the strategy gate fails', () => {
    const s = scoreAlert(alert(), { market: market(), book: book(), model });
    const noMaker = { ...s, maker: null, promote: false };
    eq(decideEntries('maker_spread', { alert: alert(), market: market(), book: book(), score: noMaker, model }).length, 0);
  });

  test('decideEntries sizes below the resting depth', () => {
    const s = scoreAlert(alert(), { market: market(), book: book({ size: 40 }), model });
    const intents = decideEntries('maker_spread', { alert: alert(), market: market(), book: book({ size: 40 }), score: s, model });
    if (intents.length) assert(intents[0].contracts <= 10, `sized ${intents[0].contracts}, must stay under 25% of 40`);
  });

  test('the control strategy is explicitly documented as a control', () => {
    assert(STRATEGIES.taker_fade.thesis.toLowerCase().includes('control'));
  });
});

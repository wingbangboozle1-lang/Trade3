// Verify the fee implementation against the OFFICIAL fee schedule table itself.
//
// K6 https://kalshi.com/docs/kalshi-fee-schedule.pdf, "General Trading Fees Table":
// price of 1 contract -> fee for 1 contract, and price of 100 -> fee for 100.
// The table rounds up to whole cents (see research/findings.md F11). We assert two
// things separately so a future change cannot hide a regression:
//   1. the raw formula reproduces the published numbers when rounded to cents, and
//   2. our centicent fee is never LOWER than the raw formula (it rounds up).

import { suite, test, assert, eq, near } from './harness.mjs';
import { rawFeeDollars, feeTicks, feeTicksCenticent, multiplierForSeries, SERIES_FEE_MULTIPLIERS } from '../app/lib/fees.mjs';

// Transcribed from the PDF table, 1-contract column and 100-contract column.
const TABLE = [
  [0.01, 0.01, 0.07],
  [0.05, 0.01, 0.34],
  [0.10, 0.01, 0.63],
  [0.15, 0.01, 0.90],
  [0.20, 0.02, 1.12],
  [0.25, 0.02, 1.32],
  [0.30, 0.02, 1.47],
  [0.35, 0.02, 1.60],
  [0.40, 0.02, 1.68],
  [0.45, 0.02, 1.74],
  [0.50, 0.02, 1.75],
  [0.55, 0.02, 1.74],
  [0.60, 0.02, 1.68],
  [0.65, 0.02, 1.60],
  [0.70, 0.02, 1.47],
  [0.75, 0.02, 1.32],
  [0.80, 0.02, 1.12],
  [0.85, 0.01, 0.90],
  [0.90, 0.01, 0.63],
  [0.95, 0.01, 0.34],
  [0.99, 0.01, 0.07]
];

suite('fees — official schedule reconciliation (K6)', () => {
  test('100-contract column matches roundup(0.07 x C x P x (1-P)) to the cent', () => {
    for (const [p, , fee100] of TABLE) {
      const raw = rawFeeDollars(100, p, 1, false);
      const roundedToCent = Math.ceil(raw * 100 - 1e-9) / 100;
      near(roundedToCent, fee100, 0.005, `P=${p}`);
    }
  });

  test('1-contract column is the same formula rounded up to the cent', () => {
    for (const [p, fee1] of TABLE) {
      const raw = rawFeeDollars(1, p, 1, false);
      const roundedToCent = Math.ceil(raw * 100 - 1e-9) / 100;
      near(roundedToCent, fee1, 0.005, `P=${p}`);
    }
  });

  test('centicent fee is never below the raw formula (it rounds up)', () => {
    for (const [p] of TABLE) {
      for (const c of [1, 3, 10, 100, 1000]) {
        const raw = rawFeeDollars(c, p, 1, false);
        const ours = feeTicksCenticent(c, p, { multiplier: 1 }) / 1e6;
        assert(ours >= raw - 1e-9, `fee ${ours} < raw ${raw} at P=${p} C=${c}`);
      }
    }
  });

  test('fee at the extremes is zero-ish and symmetric around 0.50', () => {
    eq(feeTicksCenticent(100, 0, { multiplier: 1 }), 0, 'P=0 has no fee');
    eq(feeTicksCenticent(100, 1, { multiplier: 1 }), 0, 'P=1 has no fee');
    eq(
      feeTicksCenticent(100, 0.3, { multiplier: 1 }),
      feeTicksCenticent(100, 0.7, { multiplier: 1 }),
      'fee(P) = fee(1-P)'
    );
  });

  test('maker multiplier defaults to 0 for an unlisted series (K6 wording)', () => {
    const m = multiplierForSeries('KXNOTAREALSERIES');
    eq(m.taker, 1, 'taker default is 1');
    eq(m.maker, 0, 'maker default is 0 per the schedule');
  });

  test('listed series multipliers are honoured', () => {
    eq(multiplierForSeries('KXAAAGASM').taker, 1);
    eq(multiplierForSeries('KXBTCY').taker, 0, 'KXBTCY is 0x/0x on the schedule');
    eq(multiplierForSeries('KXELECTIRAN').taker, 0);
    assert(Object.keys(SERIES_FEE_MULTIPLIERS).length >= 10, 'multiplier table is populated');
  });

  test('maker fee is exactly a quarter of taker at the same multiplier', () => {
    // 0.0175 / 0.07 = 0.25 exactly, so this must hold up to the rounding grid.
    const taker = feeTicksCenticent(100, 0.5, { multiplier: 1 });
    const maker = feeTicksCenticent(100, 0.5, { multiplier: 1, maker: true });
    near(maker / taker, 0.25, 0.02, 'maker/taker ratio');
  });

  test('an explicit zero multiplier charges nothing', () => {
    eq(feeTicksCenticent(1000, 0.5, { multiplier: 0 }), 0, 'zero multiplier => zero fee');
  });

  test('feeTicks rounds up to $0.000001 granularity (K7)', () => {
    const t = feeTicks(1, 0.01, { multiplier: 1 });
    eq(t, 693, '0.07*1*0.01*0.99 = 0.000693 exactly');
  });
});

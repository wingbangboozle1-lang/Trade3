// The threshold is the core requirement: "sudden swings >= $0.10 in either
// direction". These tests pin the exact boundary so an off-by-one cent cannot slip in.

import { suite, test, assert, eq } from './harness.mjs';
import { AlertEngine } from '../app/lib/alerts.mjs';

const T = 1_000_000;
const t0 = 1_700_000_000_000;

function engine(overrides = {}) {
  return new AlertEngine({ thresholdTicks: 100_000, cooldownMs: 0, driftWindowMs: 300_000, ...overrides });
}

suite('alerts — $0.10 threshold', () => {
  test('exactly 10c up fires', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 });
    const a = e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 + 1000 });
    assert(a, 'should fire');
    eq(a.deltaTicks, 100_000);
    eq(a.direction, 'up');
  });

  test('exactly 10c down fires', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 });
    const a = e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 + 1000 });
    assert(a, 'should fire');
    eq(a.deltaTicks, -100_000);
    eq(a.direction, 'down');
  });

  test('9.99c does not fire', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 });
    eq(e.observe({ ticker: 'M', ticks: 499_900, tsMs: t0 + 1000 }), null);
  });

  test('10.01c fires', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 });
    assert(e.observe({ ticker: 'M', ticks: 500_100, tsMs: t0 + 1000 }));
  });

  test('a slow drift totalling 10c fires on the window detector', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 });
    // 2c steps: each one is too small for the print detector, and the fifth step
    // reaches exactly 10c, which is the threshold, so the window detector fires there.
    const kinds = [];
    for (let i = 1; i <= 5; i += 1) {
      const a = e.observe({ ticker: 'M', ticks: 400_000 + i * 20_000, tsMs: t0 + i * 20_000 });
      if (a) kinds.push(a);
    }
    eq(kinds.length, 1, 'exactly one alert across the creep, not one per step');
    const a = kinds[0];
    eq(a.kind, 'drift');
    eq(a.fromTicks, 400_000, 'anchor is the window low we actually observed');
    eq(a.deltaTicks, 100_000);
  });

  test('a round trip that ends where it started still reports the swing', () => {
    const e = engine({ cooldownMs: 0 });
    e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 });
    e.observe({ ticker: 'M', ticks: 520_000, tsMs: t0 + 5_000 });
    const a = e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 + 10_000 });
    assert(a, 'the 12c drop is reported');
    // and the recovery back to 520k is also a >=10c swing
    const b = e.observe({ ticker: 'M', ticks: 505_000, tsMs: t0 + 15_000 });
    assert(b, 'the rebound is reported too');
  });

  test('no false drift alert in the first seconds of a market history', () => {
    const e = new AlertEngine({ thresholdTicks: 100_000, cooldownMs: 0, driftWindowMs: 300_000 });
    e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 });
    // 10c move but no anchor older than half a window: must not be reported as drift
    const a = e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 + 5_000 });
    if (a) eq(a.kind, 'print', 'a young-history move can only be a print alert');
  });

  test('cooldown suppresses a follow-on alert on the same market', () => {
    const e = new AlertEngine({ thresholdTicks: 100_000, cooldownMs: 15_000, driftWindowMs: 300_000 });
    e.observe({ ticker: 'M', ticks: 300_000, tsMs: t0 });
    assert(e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0 + 1000 }), 'first fires');
    eq(e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 + 2000 }), null, 'second suppressed by cooldown');
    assert(e.observe({ ticker: 'M', ticks: 600_000, tsMs: t0 + 20_000 }), 'fires again after cooldown');
  });

  test('repeat prints at the same price never fire', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 });
    for (let i = 0; i < 5; i += 1) eq(e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 + i * 1000 }), null);
  });

  test('prices outside $0.01..$0.99 are rejected, not alerting on garbage', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 500_000, tsMs: t0 });
    eq(e.observe({ ticker: 'M', ticks: 0, tsMs: t0 + 1000 }), null);
    eq(e.observe({ ticker: 'M', ticks: 1_000_000, tsMs: t0 + 1000 }), null);
    eq(e.observe({ ticker: 'M', ticks: -5, tsMs: t0 + 1000 }), null);
    eq(e.observe({ ticker: 'M', ticks: NaN, tsMs: t0 + 1000 }), null);
  });

  test('markets are independent', () => {
    const e = engine();
    e.observe({ ticker: 'A', ticks: 300_000, tsMs: t0 });
    e.observe({ ticker: 'B', ticks: 700_000, tsMs: t0 });
    assert(e.observe({ ticker: 'A', ticks: 400_000, tsMs: t0 + 1000 }), 'A fires');
    eq(e.observe({ ticker: 'B', ticks: 690_000, tsMs: t0 + 1000 }), null, 'B only moved 1c');
  });

  test('history is bounded so a long-running process cannot grow without limit', () => {
    const e = new AlertEngine({ thresholdTicks: 100_000, cooldownMs: 0, driftWindowMs: 60_000, historyMs: 60_000 });
    for (let i = 0; i < 500; i += 1) e.observe({ ticker: 'M', ticks: 100_000 + (i % 50) * 1_000, tsMs: t0 + i * 1000 });
    const buf = e.seriesFor('M');
    assert(buf.length < 80, `buffer trimmed, still ${buf.length} points`);
  });

  test('an alert records both observations so it can be audited', () => {
    const e = engine();
    e.observe({ ticker: 'M', ticks: 400_000, tsMs: t0, source: 'trade' });
    const a = e.observe({ ticker: 'M', ticks: 520_000, tsMs: t0 + 3000, source: 'trade', size: 12 });
    eq(a.fromTicks, 400_000);
    eq(a.toTicks, 520_000);
    eq(a.fromTs, t0);
    eq(a.toTs, t0 + 3000);
    eq(a.source, 'trade');
    eq(a.size, 12);
    assert(a.id.startsWith('al_'));
  });
});

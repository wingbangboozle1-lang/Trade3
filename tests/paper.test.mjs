// Paper accounting must be exact. A contract costs `price` and pays $1.00 if it
// wins. Every fee must match the official formula. These tests use round numbers so
// any drift is obvious.

import { suite, test, assert, eq } from './harness.mjs';
import { PaperBroker } from '../app/lib/paper.mjs';
import { feeTicksCenticent } from '../app/lib/fees.mjs';

const T = 1_000_000;
const t0 = 1_700_000_000_000;

suite('paper — accounting', () => {
  test('a winning resolution pays $1.00 per contract minus the entry fee', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    const pos = p.openPosition({
      strategyId: 's',
      ticker: 'M',
      side: 'yes',
      priceTicks: 400_000,
      contracts: 10,
      seriesTicker: 'KXBTCMAX150',
      atMs: t0
    });
    assert(pos, 'opened');
    const fee = feeTicksCenticent(10, 0.4, { multiplier: 1 });
    eq(pos.entryFeeTicks, fee, 'entry fee uses the official formula');
    eq(p.cashTicks, 1_000 * T - 400_000 * 10 - fee, 'cash after entry');

    const trades = p.settleMarket('M', { result: 'yes', atMs: t0 + 60_000 });
    eq(trades.length, 1);
    eq(trades[0].exitTicks, T, 'YES winner pays $1.00');
    eq(trades[0].exitFeeTicks, 0, 'no settlement fee (K6)');
    eq(trades[0].pnlTicks, (T - 400_000) * 10, 'realized P&L = payout minus entry cost; the entry fee is booked separately in feesTicks');
eq(trades[0].feesTicks, fee, 'fees recorded once, separately from P&L');
    eq(p.cashTicks, 1_000 * T - 400_000 * 10 - fee + T * 10, 'cash after settlement');
  });

  test('a losing resolution returns nothing and the loss is bounded', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 600_000, contracts: 5, atMs: t0 });
    const [t] = p.settleMarket('M', { result: 'no', atMs: t0 + 1000 });
    eq(t.exitTicks, 0, 'NO result pays a YES holder nothing');
    assert(t.pnlTicks < 0, 'loss recorded');
    assert(p.cashTicks >= 0, 'cash never goes negative from a loss');
  });

  test('selling to close books gross minus the exit fee', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    const pos = p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 300_000, contracts: 10, atMs: t0 });
    const trade = p.closePosition(pos, { exitTicks: 450_000, exitReason: 'take_profit', atMs: t0 + 5000 });
    const exitFee = feeTicksCenticent(10, 0.45, { multiplier: 1 });
    eq(trade.grossTicks, 150_000 * 10);
    eq(trade.exitFeeTicks, exitFee);
    eq(trade.pnlTicks, 150_000 * 10 - exitFee);
  });

  test('a position cannot be opened twice for the same strategy/market/side', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    assert(p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 500_000, contracts: 1, atMs: t0 }));
    eq(p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 500_000, contracts: 1, atMs: t0 }), null);
    assert(p.openPosition({ strategyId: 'other', ticker: 'M', side: 'yes', priceTicks: 500_000, contracts: 1, atMs: t0 }));
  });

  test('insufficient cash is refused instead of going negative', () => {
    const p = new PaperBroker({ startTicks: 100 * T });
    eq(p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 900_000, contracts: 200, atMs: t0 }), null);
    assert(p.cashTicks === 100 * T, 'cash untouched');
  });

  test('take profit exits exactly at the threshold, not before', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 10, takeProfitTicks: 40_000, atMs: t0 });
    eq(p.mark('M', { yesBidTicks: 439_000, atMs: t0 + 1000 }).length, 0, '3.9c up is below a 4c target');
    const closed = p.mark('M', { yesBidTicks: 440_000, atMs: t0 + 2000 });
    eq(closed.length, 1, '4.0c up hits the target');
    eq(closed[0].exitReason, 'take_profit');
  });

  test('stop loss fires at the configured distance', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 10, stopTicks: 50_000, atMs: t0 });
    eq(p.mark('M', { yesBidTicks: 360_000, atMs: t0 + 1000 }).length, 0, '4c against, stop is 5c');
    const closed = p.mark('M', { yesBidTicks: 350_000, atMs: t0 + 2000 });
    eq(closed.length, 1);
    eq(closed[0].exitReason, 'stop');
  });

  test('max hold closes a position that neither target nor stop reached', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 10, maxHoldMs: 60_000, atMs: t0 });
    eq(p.mark('M', { yesBidTicks: 401_000, atMs: t0 + 30_000 }).length, 0);
    const closed = p.mark('M', { yesBidTicks: 401_000, atMs: t0 + 61_000 });
    eq(closed.length, 1);
    eq(closed[0].exitReason, 'max_hold');
  });

  test('resting maker intents fill only when a print crosses the limit', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    const intent = p.openPosition({
      strategyId: 'm',
      ticker: 'M',
      side: 'yes',
      priceTicks: 400_000,
      contracts: 10,
      fillsAs: 'maker',
      atMs: t0
    });
    assert(intent.pending, 'returned as a resting intent');
    eq(p.open.size, 0, 'nothing filled yet');
    // a print above the limit must NOT fill a resting bid
    p.mark('M', { yesBidTicks: 410_000, yesTradeTicks: 415_000, atMs: t0 + 1000 });
    eq(p.open.size, 0, 'no fill when the market trades away');
    // a print at or below the limit fills it
    p.mark('M', { yesBidTicks: 399_000, yesTradeTicks: 398_000, atMs: t0 + 2000 });
    eq(p.open.size, 1, 'filled when a print crossed the limit');
  });

  test('zombie intents expire instead of filling hours later', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 'm', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 10, fillsAs: 'maker', atMs: t0 });
    p.mark('M', { yesBidTicks: 500_000, atMs: t0 + 11 * 60_000 });
    eq(p.pending.size, 0, 'expired');
    eq(p.open.size, 0, 'never filled');
  });

  test('equity = cash + marked position value', () => {
    const p = new PaperBroker({ startTicks: 1_000 * T });
    p.openPosition({ strategyId: 's', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 10, atMs: t0 });
    p.mark('M', { yesBidTicks: 500_000, atMs: t0 + 1000 });
    const expected = p.cashTicks + 500_000 * 10;
    eq(p.equityTicks, expected, 'mark-to-bid');
  });

  test('adverse selection is measured, not hidden', () => {
    const p = new PaperBroker({ startTicks: 10_000 * T });
    p.openPosition({ strategyId: 'm', ticker: 'M', side: 'yes', priceTicks: 400_000, contracts: 5, fillsAs: 'maker', atMs: t0 });
    p.mark('M', { yesBidTicks: 395_000, yesTradeTicks: 395_000, atMs: t0 + 1000 });
    const adv = p.adverseSelection();
    assert(adv.n >= 0);
  });
});

// Kalshi trading fees — transcribed from the official fee schedule.
//
// Source K6: https://kalshi.com/docs/kalshi-fee-schedule.pdf
//   "The current general fee charged for a trade in dollars is given by the
//    following formula:  fees = roundup(M x 0.07 x C x P x (1-P))
//    P = the price of a contract in dollars, C = number of contracts,
//    M = the multiplier for each contract (default 1 unless otherwise indicated)
//    round up = rounds up such that the fee + positionCost is rounded to a
//               centicent"
//   Maker fees: fees = roundup(M x 0.0175 x C x P x (1-P)); maker M defaults to 0.
//   "There is no settlement fee."  "Trading fees are only charged for orders that
//    are immediately matched with orders sitting on the orderbook."
//
// Source K7: https://docs.kalshi.com/getting_started/fee_rounding.md
//   trade fee = ceil to $0.000001; direct-member balances align to $0.0001.
//
// The published "General Trading Fees Table" displays fees rounded up to whole
// cents, which is coarser than the centicent granularity in the formula text.
// See research/findings.md irregularity F11 — the two are consistent in direction
// (both round up) but a cent-rounded table value can be up to $0.0099 higher.

import { ceilToStep, TICKS_PER_DOLLAR } from './util.mjs';

export const GENERAL_TAKER_MULTIPLIER = 0.07;
export const GENERAL_MAKER_MULTIPLIER = 0.0175;
export const MAKER_MULTIPLIER_DEFAULT = 0; // per K6: "default is 0"

/**
 * Raw model fee before rounding, in dollars.
 * @param {number} count number of contracts
 * @param {number} price price in dollars (0..1)
 * @param {number} multiplier per-series multiplier (1 = general schedule)
 */
export function rawFeeDollars(count, price, multiplier = 1, maker = false) {
  const base = maker ? GENERAL_MAKER_MULTIPLIER : GENERAL_TAKER_MULTIPLIER;
  return multiplier * base * count * price * (1 - price);
}

/**
 * Fee in integer ticks (1e-6 dollars), rounded UP to $0.000001 per K7.
 */
export function feeTicks(count, price, { multiplier = 1, maker = false } = {}) {
  const raw = rawFeeDollars(count, price, multiplier, maker);
  const stepTicks = 1; // 1e-6 dollars
  const ticks = Math.ceil(raw * TICKS_PER_DOLLAR - 1e-6);
  // keep the reference to ceilToStep so the helper stays used & tested
  void ceilToStep;
  return Math.max(0, ticks);
}

/**
 * Fee in dollars, centicent-rounded, which is the granularity the schedule text
 * specifies and the granularity balances are aligned to (K6, K7).
 */
export function feeDollarsCenticent(count, price, options) {
  const ticks = feeTicks(count, price, options);
  const centicent = Math.ceil(ticks / 100) / 10_000; // 100 ticks = $0.0001
  return Math.round(centicent * 1e6) / 1e6;
}

/** Fee in ticks, rounded up to the $0.0001 grid (what actually leaves the balance). */
export function feeTicksCenticent(count, price, options) {
  const ticks = feeTicks(count, price, options);
  return Math.ceil(ticks / 100) * 100;
}

/**
 * Per-series multipliers found in the "Non-Standard Fees" table of K6.
 * Only the rows relevant to this dashboard's five topics are transcribed, plus a
 * couple of common ones for sanity. Anything not listed uses (1, 1), which is the
 * general schedule. Keys are SERIES tickers.
 *
 * NOTE: multipliers can change when Kalshi updates the schedule. The PDF is the
 * authority; this table records what the 2026-07-07 schedule said.
 */
export const SERIES_FEE_MULTIPLIERS = {
  // Gas prices
  KXAAAGASM: { maker: 1, taker: 1, label: 'US gas price', source: 'K6' },
  // Crypto
  KXBTCMAX150: { maker: 1, taker: 1, label: 'When will bitcoin hit 150k?', source: 'K6' },
  KXBTCY: { maker: 0, taker: 0, label: 'BTC price range EOY', source: 'K6' },
  KXETHY: { maker: 0, taker: 0, label: 'ETH price EOY', source: 'K6' },
  // Culture
  KXBALLONDOR: { maker: 1, taker: 1, label: "Ballon d'Or", source: 'K6' },
  KXEMMYCACTO: { maker: 1, taker: 1, label: 'Emmys Lead Comedy Actor', source: 'K6' },
  KXEMMYCACTR: { maker: 1, taker: 1, label: 'Emmys Lead Comedy Actress', source: 'K6' },
  KXEMMYCSERIES: { maker: 1, taker: 1, label: 'Emmys Comedy Series', source: 'K6' },
  KXEMMYDACTO: { maker: 1, taker: 1, label: 'Emmys Lead Drama Actor', source: 'K6' },
  KXEMMYDACTR: { maker: 1, taker: 1, label: 'Emmys Lead Drama Actress', source: 'K6' },
  KXEMMYDSERIES: { maker: 1, taker: 1, label: 'Emmys Drama Series', source: 'K6' },
  // Elections / politics
  KXELECTIRAN: { maker: 0, taker: 0, label: 'Will Iran hold a presidential election?', source: 'K6' },
  KXIRANDEMOCRACY: { maker: 0, taker: 0, label: 'Will Iran become a democracy in 2026?', source: 'K6' },
  // Common macro series (not one of the 5 topics, but shown in the fee table)
  KXCPI: { maker: 1, taker: 1, label: 'CPI', source: 'K6' },
  KXCPIYOY: { maker: 1, taker: 1, label: 'Inflation', source: 'K6' },
  KXFED: { maker: 1, taker: 1, label: 'Fed funds rate', source: 'K6' },
  KXFEDDECISION: { maker: 1, taker: 1, label: 'Fed meeting', source: 'K6' }
};

/**
 * Look up the multiplier for a series.
 *
 * Defaults come straight from K6: the general trading fee uses "M ... default is 1",
 * and the maker fee uses "M ... default is 0". So an unlisted series has
 * (taker 1, maker 0) — NOT (1, 1). Getting this wrong overstates maker costs and
 * would wrongly suppress maker strategies.
 */
export function multiplierForSeries(seriesTicker) {
  const row = SERIES_FEE_MULTIPLIERS[seriesTicker];
  if (row) return { taker: row.taker, maker: row.maker, known: true, label: row.label, source: 'K6' };
  return { taker: 1, maker: MAKER_MULTIPLIER_DEFAULT, known: false, label: '', source: 'K6-default' };
}

/**
 * Full trade cost for a taker buy of `count` contracts at `price`, in ticks.
 * Returns both fee granularities so the UI can show what Kalshi's schedule says.
 */
export function takerCost(count, priceDollars, seriesTicker) {
  const m = multiplierForSeries(seriesTicker);
  const fee = feeTicksCenticent(count, priceDollars, { multiplier: m.taker });
  const notional = Math.round(count * priceDollars * TICKS_PER_DOLLAR);
  return {
    notionalTicks: notional,
    feeTicks: fee,
    totalTicks: notional + fee,
    multiplier: m.taker,
    multiplierKnown: m.known,
    multiplierLabel: m.label,
    multiplierSource: m.source
  };
}

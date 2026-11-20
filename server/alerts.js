/**
 * Swing-alert engine.
 *
 * Requirement: alert when a contract price moves by >= $0.10 in either direction.
 *
 * Implementation notes that matter for correctness:
 *  - The threshold is inclusive (>=), and is compared on the *absolute* difference
 *    between the price now and the reference price, so both directions fire.
 *  - Prices are compared in integer cents-scaled space (1/10000 of a dollar) to avoid
 *    floating-point drift making exactly-$0.10 moves look like $0.09999.
 *  - Two independent reference prices exist, and both are reported separately
 *    because they answer different questions:
 *      * `tick`  - the previous observed price for that market (fast, alerts on noise)
 *      * `day`   - Kalshi's own `previous_price_dollars` field, documented as
 *                  "Price for the last traded YES contract on this market a day ago"
 *  - A swing is stored with from/to prices, direction, timestamps and the liquidity
 *    context at alert time so the alert feed is auditable after the fact.
 */

export const SWING_THRESHOLD_DOLLARS = 0.1;
const SCALE = 10000; // Kalshi prices are fixed-point dollars with 4 decimals.

export function toTicks(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * SCALE);
}

export function fromTicks(ticks) {
  return ticks / SCALE;
}

/** Absolute move in dollars, rounded to 4dp. */
export function moveDollars(from, to) {
  const a = toTicks(from);
  const b = toTicks(to);
  if (a === null || b === null) return null;
  return Math.round(Math.abs(b - a)) / SCALE;
}

/** True when the move meets or exceeds the $0.10 requirement, in either direction. */
export function isSwing(from, to, threshold = SWING_THRESHOLD_DOLLARS) {
  const move = moveDollars(from, to);
  if (move === null) return false;
  return toTicks(move) >= toTicks(threshold);
}

export function direction(from, to) {
  const a = toTicks(from);
  const b = toTicks(to);
  if (a === null || b === null) return null;
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'flat';
}

/**
 * Stateful detector. One instance per collector run.
 * `observe()` is the only input; it returns zero or more alert objects.
 */
export class SwingDetector {
  constructor({ threshold = SWING_THRESHOLD_DOLLARS, tickCooldownMs = 0 } = {}) {
    this.threshold = threshold;
    this.tickCooldownMs = tickCooldownMs;
    this.last = new Map(); // ticker -> { price, ts, dayRef }
    this.lastTickAlert = new Map(); // ticker -> ts
  }

  /**
   * @param {object} market  market object from GET /markets
   * @param {object} opts    { price, ts, liquidity, topicId, reason, source }
   * @returns {Array<object>} alerts (possibly empty)
   */
  observe(market, opts = {}) {
    const ticker = market.ticker;
    const price = Number(opts.price ?? market.last_price_dollars);
    if (!Number.isFinite(price)) return [];

    const ts = opts.ts ?? Date.now();
    const alerts = [];
    const prev = this.last.get(ticker);

    // Day-over-day reference provided by Kalshi itself.
    const dayRef = Number(market.previous_price_dollars);

    if (prev && isSwing(prev.price, price, this.threshold)) {
      const lastAlertAt = this.lastTickAlert.get(ticker) ?? 0;
      if (ts - lastAlertAt >= this.tickCooldownMs) {
        alerts.push(this.#alert(market, prev.price, price, ts, prev.ts, 'tick', opts, prev.price));
        this.lastTickAlert.set(ticker, ts);
      }
    }

    // Day reference is evaluated only on the first sighting of a market, because the
    // field itself only changes once a day; re-firing it every poll would spam the feed.
    if (!prev && Number.isFinite(dayRef) && isSwing(dayRef, price, this.threshold)) {
      alerts.push(this.#alert(market, dayRef, price, ts, null, 'day', opts, dayRef));
    }

    this.last.set(ticker, { price, ts, dayRef: Number.isFinite(dayRef) ? dayRef : null });
    return alerts;
  }

  snapshot() {
    return Object.fromEntries(this.last);
  }

  #alert(market, fromPrice, toPrice, ts, fromTs, basis, opts, referencePrice) {
    const dir = direction(fromPrice, toPrice);
    return {
      id: `${market.ticker}:${ts}:${basis}`,
      ticker: market.ticker,
      eventTicker: market.event_ticker,
      seriesTicker: opts.seriesTicker ?? market.series_ticker ?? null,
      title: market.title,
      yesSubTitle: market.yes_sub_title ?? null,
      topicId: opts.topicId ?? null,
      topicReason: opts.reason ?? null,
      direction: dir,
      fromPrice: fromTicks(toTicks(fromPrice)),
      toPrice: fromTicks(toTicks(toPrice)),
      moveDollars: moveDollars(fromPrice, toPrice),
      basis, // 'tick' | 'day'
      referencePrice: fromTicks(toTicks(referencePrice)),
      ts,
      fromTs,
      source: opts.source ?? 'rest',
      liquidity: opts.liquidity ?? null,
      kalshiUrl: opts.kalshiUrl ?? null,
    };
  }
}

/**
 * Score a swing for the "high-ROI model" feed.
 *
 * This is a transparent, documented heuristic - not a claim of profitability. Every
 * term is visible in the returned `factors` so the UI can show the arithmetic.
 *
 *   edge        = estimated fair value minus executable price
 *   fair value  = liquidity-weighted blend of mid and last trade, plus drift
 *   cost        = Kalshi trading fee estimate + spread paid
 *   score       = edge / cost  (higher is better), scaled to 0-100 for display
 *
 * Kalshi fee model - VERIFIED from the official fee schedule
 * (https://kalshi.com/docs/kalshi-fee-schedule.pdf, last updated 2026-07-07):
 *
 *     fees = round up( M x 0.07 x C x P x (1 - P) )
 *
 *   P = price of a contract in dollars, C = number of contracts,
 *   M = multiplier for each contract (default 1), and "round up" rounds so that
 *   fee + positionCost lands on a centicent.
 *
 * The series object supplies `fee_multiplier` (M) and `fee_type`. The same document
 * lists non-standard series, e.g. KXBTCY and KXETHY carry a 0 multiplier, and
 * KXAAAGASM ("US gas price") carries 1. Maker fees use 0.0175 instead of 0.07.
 */
export function roiScore({
  fromPrice,
  toPrice,
  spread = null,
  liquidityDollars = 0,
  openInterest = 0,
  volume24h = 0,
  feeMultiplier = 1,
  timeToCloseHours = null,
}) {
  const p = Number(toPrice);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    return { score: 0, factors: { reason: 'price at boundary; no edge modelled' } };
  }

  const spreadCost = Number.isFinite(spread) ? Math.max(0, spread) / 2 : 0.01;
  const drift = Number(toPrice) - Number(fromPrice);

  // Fee per contract: M x 0.07 x P x (1 - P) for C = 1, per the official schedule.
  const fee = Math.min(1, Math.max(0, feeMultiplier * 0.07 * p * (1 - p)));
  const costPerContract = spreadCost + fee;

  // Fast, large, liquid moves are considered more tradable. Liquidity term saturates.
  const liqTerm = Math.min(1, Math.log10(1 + Math.max(0, liquidityDollars)) / 4); // $10k books -> 1
  const oiTerm = Math.min(1, Math.log10(1 + Math.max(0, openInterest)) / 4);
  const volTerm = Math.min(1, Math.log10(1 + Math.max(0, volume24h)) / 4);
  const flow = (liqTerm + oiTerm + volTerm) / 3;

  // Momentum: a big move that has *not* already run to an extreme is more interesting.
  const momentum = Math.min(1, Math.abs(drift) / 0.25) * (1 - Math.abs(p - 0.5) * 1.2);

  // Edge proxy: momentum x flow, expressed in dollars per contract, minus cost.
  const grossEdge = Math.max(0, momentum * flow) * 0.25;
  const netEdge = grossEdge - costPerContract;
  const ratio = costPerContract > 0 ? netEdge / costPerContract : 0;

  // Time decay: if the market closes soon the edge must be realised quickly.
  const timeTerm =
    timeToCloseHours === null || !Number.isFinite(timeToCloseHours)
      ? 1
      : Math.max(0.15, Math.min(1, timeToCloseHours / 24));

  const score = Math.max(0, Math.min(100, Math.round(ratio * 20 * timeTerm + momentum * flow * 25)));

  return {
    score,
    factors: {
      price: p,
      driftDollars: Math.round(drift * 10000) / 10000,
      spreadCostPerContract: round(spreadCost),
      feePerContract: round(fee),
      costPerContract: round(costPerContract),
      feeSource: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf',
      grossEdgePerContract: round(grossEdge),
      netEdgePerContract: round(netEdge),
      liquidityTerm: round(liqTerm),
      openInterestTerm: round(oiTerm),
      volumeTerm: round(volTerm),
      momentumTerm: round(momentum),
      timeTerm: round(timeTerm),
      ratio: round(ratio),
    },
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

/** Minimum score for the selective "model likes" feed. */
export const HIGH_ROI_MIN_SCORE = 45;

// The scoring model behind the "Model picks" chat, plus the strategy families the
// simulated trader runs.
//
// ---------------------------------------------------------------------------
// WHY THE MODEL LOOKS LIKE THIS (read before trusting the numbers)
// ---------------------------------------------------------------------------
// A naive "fade every 10c move" model has NO edge: to fade you must cross the
// spread, so your cost is already the ask. Expected value at the new mid is
// exactly minus half the spread, before fees. That is arithmetic, not opinion.
//
// The edge that actually exists in a binary book is liquidity provision:
//   * Post a resting order instead of taking. Your cost becomes the BID, so the
//     gap between bid and mid (half the spread) is yours.
//   * Maker fees default to a multiplier of 0 on Kalshi's general schedule
//     (K6: "M = the multiplier for each contract (default is 0 ...)" for maker
//     fees), so that half-spread is not eaten by fees.
//   * The documented risk is real: you only get filled when someone wants out, so
//     fills cluster in the moves that go against you. That is adverse selection and
//     it is measured separately in the ledger (`adverseFillRate`).
//
// So the model emits TWO views:
//   maker : post a bid on the side that just got cheaper; EV = mid - bid - makerFee
//   taker : cross the spread; EV = mid - ask - takerFee  (normally negative)
// The "Model picks" chat promotes on the MAKER view only, because the taker view is
// structurally -EV. Publishing a promotion on a negative-expectation trade would be
// dishonest.
//
// Everything below is computed from observed prices, observed book depth, the
// official fee formula, and the documented mutually-exclusive structure of an event
// (K11: `mutually_exclusive` "at most one market in this event can resolve to yes").
// Nothing predicts the future; the outputs are conditions, not forecasts.
// ---------------------------------------------------------------------------

import { feeTicksCenticent, multiplierForSeries } from './fees.mjs';

const T = 1_000_000;

export const STRATEGIES = {
  maker_spread: {
    id: 'maker_spread',
    name: 'Maker spread capture',
    fillsAs: 'maker',
    thesis:
      'After a shock, rest a bid on the side that got cheaper at or inside the current bid. You are paid the half-spread; maker fees are 0x on the general schedule (K6). Exit when the mid reverts or at resolution.',
    entrySide: 'opposite',
    takeProfitTicks: 40_000,
    stopTicks: 90_000,
    maxHoldMs: 4 * 3600_000,
    needsGate: 'maker'
  },
  maker_coherence: {
    id: 'maker_coherence',
    name: 'Mutually-exclusive coherence',
    fillsAs: 'maker',
    thesis:
      'In a mutually exclusive event the YES prices must sum to <= $1.00 (K11). When a shock pushes the sum above $1.00 plus fees, rest bids on the NO legs; when it collapses below $1.00 minus fees, rest bids on the YES legs.',
    entrySide: 'coherence',
    takeProfitTicks: 50_000,
    stopTicks: 90_000,
    maxHoldMs: 6 * 3600_000,
    needsGate: 'coherence'
  },
  taker_fade: {
    id: 'taker_fade',
    name: 'Taker fade (control)',
    fillsAs: 'taker',
    thesis:
      'Control group: cross the spread to fade the shock. Included on purpose so the ledger can show how much the spread and taker fees cost versus the maker strategy.',
    entrySide: 'opposite',
    takeProfitTicks: 80_000,
    stopTicks: 60_000,
    maxHoldMs: 6 * 3600_000,
    needsGate: 'taker'
  },
  hold_to_resolution: {
    id: 'hold_to_resolution',
    name: 'Maker, hold to resolution',
    fillsAs: 'maker',
    thesis:
      'Same maker entry as spread capture, but never exits on a rule: the position rides to the market\'s determined YES/NO so the ledger records terminal outcomes (K21).',
    entrySide: 'opposite',
    takeProfitTicks: null,
    stopTicks: null,
    maxHoldMs: 30 * 24 * 3600_000,
    needsGate: 'maker'
  }
};

export function strategyList() {
  return Object.values(STRATEGIES).map((s) => ({ ...s }));
}

/** Best YES ask is implied from the NO side: 1 - best NO bid (K5). */
export function impliedAsk(levels) {
  if (!levels || !levels.length) return null;
  const best = levels[levels.length - 1]; // ascending -> last is highest bid (K5)
  return T - best.ticks;
}

/**
 * Summarise a two-sided ladder. Levels are ascending [price,count] pairs (K5), so
 * the last element is the touch. Sizes are aggregated per price level (K5).
 */
export function depthSummary(yesLevels = [], noLevels = []) {
  const sum = (l) => l.reduce((n, x) => n + x.count, 0);
  const bestYesBid = yesLevels.length ? yesLevels[yesLevels.length - 1].ticks : null;
  const bestNoBid = noLevels.length ? noLevels[noLevels.length - 1].ticks : null;
  const bestYesAsk = bestNoBid === null ? null : T - bestNoBid;
  const bestNoAsk = bestYesBid === null ? null : T - bestYesBid;
  const yesMid = bestYesBid !== null && bestYesAsk !== null ? Math.round((bestYesBid + bestYesAsk) / 2) : null;
  const noMid = bestNoBid !== null && bestNoAsk !== null ? Math.round((bestNoBid + bestNoAsk) / 2) : null;
  return {
    yesContracts: yesLevels.reduce((n, x) => n + x.count, 0),
    noContracts: noLevels.reduce((n, x) => n + x.count, 0),
    yesContractsAtTouch: yesLevels.length ? yesLevels[yesLevels.length - 1].count : 0,
    noContractsAtTouch: noLevels.length ? noLevels[noLevels.length - 1].count : 0,
    bestYesBid,
    bestYesAsk,
    bestNoBid,
    bestNoAsk,
    yesMid,
    noMid,
    spreadTicks: bestYesBid !== null && bestYesAsk !== null ? bestYesAsk - bestYesBid : null
  };
}

/** Contracts available at or better than `limitTicks` on a side. */
export function depthAtOrBetter(levels = [], limitTicks, side) {
  let n = 0;
  for (const l of levels) {
    if (side === 'yes' ? l.ticks >= limitTicks : l.ticks >= limitTicks) n += l.count;
  }
  return n;
}

/**
 * Score an alert. Returns maker and taker views plus a promotion decision.
 *
 * @param {object} alert   swing from the alert engine (has fromTicks/toTicks/direction)
 * @param {object} ctx
 *   market      { closeSec, seriesTicker, mutuallyExclusive }
 *   book        depthSummary(...) or null
 *   siblings    { sumYesTicks, count, complete } for mutually exclusive events
 *   model       thresholds from config
 */
export function scoreAlert(alert, { market = {}, book = null, siblings = null, model = {} } = {}) {
  const minEdge = Math.round((model.minEdge ?? 0.005) * T);
  const minLiquidity = model.minLiquidity ?? 25;
  const maxSpread = Math.round((model.maxSpread ?? 0.08) * T);
  const maxMinutesToClose = model.maxMinutesToClose ?? 43_200;
  // Selectivity controls. Without these the model promotes every 10c move, which
  // makes the "high ROI" chat useless.
  const minReturnBps = model.minReturnBps ?? 150; // edge / price
  const minShockOverSpread = model.minShockOverSpread ?? 2; // move must dominate the noise
  const now = alert.toTs || Date.now();

  const reasons = [];
  const gates = {};

  // ---- context gates -----------------------------------------------------
  const hasBook = Boolean(book && book.bestYesBid !== null && book.bestNoBid !== null);
  gates.book = hasBook;
  if (!hasBook) reasons.push('no two-sided book: cannot price or size an entry');

  const liq = book ? Math.min(book.yesContracts, book.noContracts) : 0;
  gates.liquidity = liq >= minLiquidity;
  if (!gates.liquidity) reasons.push(`depth ${liq} < ${minLiquidity} contracts`);

  const spread = book?.spreadTicks ?? null;
  gates.spread = spread !== null && spread <= maxSpread;
  if (spread !== null && !gates.spread) {
    reasons.push(`spread ${(spread / 10_000).toFixed(1)}c > ${(maxSpread / 10_000).toFixed(1)}c cap`);
  }

  const closeSec = Number(market.closeSec || 0);
  const minutesToClose = closeSec ? (closeSec * 1000 - now) / 60000 : null;
  gates.time = minutesToClose === null ? true : minutesToClose > 1 && minutesToClose <= maxMinutesToClose;
  if (minutesToClose !== null && !gates.time) {
    reasons.push(`time to close ${Math.round(minutesToClose)}m outside (1m, ${maxMinutesToClose}m]`);
  }

  const modelMult = multiplierForSeries(market.seriesTicker || '').taker;
  const makerMult = multiplierForSeries(market.seriesTicker || '').maker;

  // ---- view 1: maker spread capture on the faded side --------------------
  // The side that got cheaper is the one we buy.
  const side = alert.direction === 'up' ? 'no' : 'yes';
  const bidTicks = side === 'yes' ? book?.bestYesBid ?? null : book?.bestNoBid ?? null;
  const midTicks = side === 'yes' ? book?.yesMid ?? null : book?.noMid ?? null;
  const askTicks = side === 'yes' ? book?.bestYesAsk ?? null : book?.bestNoAsk ?? null;

  let maker = null;
  if (bidTicks && midTicks) {
    const halfSpread = midTicks - bidTicks;
    // Rest at the current bid (conservative: no queue-jumping assumption).
    const makerFee = feeTicksCenticent(1, bidTicks / T, { multiplier: makerMult, maker: true });
    const evTicks = halfSpread - makerFee;
    maker = {
      side,
      bidTicks,
      midTicks,
      askTicks,
      halfSpreadTicks: halfSpread,
      makerFeeTicks: makerFee,
      evTicks,
      edgeBps: bidTicks ? Math.round((evTicks / bidTicks) * 10_000) : null,
      fillProbabilityNote: 'Fills only if a later trade prints at or through the bid.',
      promote: evTicks >= minEdge
    };
    if (!maker.promote) {
      reasons.push(
        `maker edge ${(evTicks / 10_000).toFixed(2)}c < ${(minEdge / 10_000).toFixed(2)}c after maker fee`
      );
    }
  } else {
    reasons.push('no bid/mid on the fade side');
  }

  // ---- view 2: taker fade (control; structurally negative) ----------------
  let taker = null;
  if (askTicks && midTicks) {
    const takerFee = feeTicksCenticent(1, askTicks / T, { multiplier: modelMult });
    const evTicks = midTicks - askTicks - takerFee; // = -halfSpread - fee
    taker = {
      side,
      askTicks,
      midTicks,
      takerFeeTicks: takerFee,
      evTicks,
      edgeBps: askTicks ? Math.round((evTicks / askTicks) * 10_000) : null,
      promote: evTicks >= minEdge
    };
  }

  // ---- view 3: coherence edge on a mutually exclusive event --------------
  let coherence = null;
  if (siblings && siblings.complete && siblings.count >= 2) {
    const sum = siblings.sumYesTicks;
    const dev = sum - T; // >0 means the legs are overpriced in aggregate
    const perLeg = Math.round(Math.abs(dev) / siblings.count);
    if (perLeg > 0) {
      // If the sum is too high, buy NO on the most expensive legs; too low, buy YES.
      const cohSide = dev > 0 ? 'no' : 'yes';
      const cohBid = cohSide === 'yes' ? book?.bestYesBid ?? null : book?.bestNoBid ?? null;
      const fee = cohBid ? feeTicksCenticent(1, cohBid / T, { multiplier: makerMult, maker: true }) : 0;
      coherence = {
        side: cohSide,
        sumYesTicks: sum,
        deviationTicks: dev,
        perLegEdgeTicks: perLeg,
        evTicks: perLeg - fee,
        legs: siblings.count,
        makerFeeTicks: fee,
        promote: perLeg - fee >= minEdge
      };
      if (!coherence.promote) {
        reasons.push(`coherence ${(perLeg / 10_000).toFixed(2)}c/leg < ${(minEdge / 10_000).toFixed(2)}c after fee`);
      }
    }
  }

  // ---- quality gates (selectivity) --------------------------------------
  // The move has to dominate the spread, otherwise "10c move" is mostly noise on a
  // wide book. And the edge has to be large relative to the capital at risk.
  const shockAbs = Math.abs(alert.deltaTicks || 0);
  gates.signalToNoise = spread !== null ? shockAbs >= minShockOverSpread * spread : true;
  if (spread !== null && !gates.signalToNoise) {
    reasons.push(
      `move ${(shockAbs / 10_000).toFixed(1)}c < ${minShockOverSpread}x spread ${(spread / 10_000).toFixed(1)}c`
    );
  }

  const anyView = (maker && maker.promote) || (coherence && coherence.promote);
  const bestEdge = Math.max(maker?.evTicks ?? -Infinity, coherence?.evTicks ?? -Infinity);
  const refPrice = maker?.bidTicks || coherence?.side === 'yes' ? maker?.bidTicks ?? null : null;
  const retBps = Number.isFinite(bestEdge) && refPrice ? Math.round((bestEdge / refPrice) * 10_000) : null;
  gates.returnOnRisk = retBps === null ? false : retBps >= minReturnBps;
  if (anyView && !gates.returnOnRisk) {
    reasons.push(`return ${retBps ?? '?'} bps < ${minReturnBps} bps of capital at risk`);
  }

  // ---- promotion --------------------------------------------------------
  // Promote when the structural gates pass, the signal dominates the spread, at
  // least one positive-EV view exists, and the edge is worth the capital.
  const structural = gates.book && gates.liquidity && gates.spread && gates.time && gates.signalToNoise;
  const promote = structural && anyView && gates.returnOnRisk;

  // Best view for display ordering.
  const views = [maker, coherence].filter(Boolean);
  const bestEv = views.length ? Math.max(...views.map((v) => v.evTicks)) : null;

  // ---- sizing -----------------------------------------------------------
  // Quarter-Kelly is not meaningful without a probability estimate, so size from
  // the edge and the depth instead: risk a fixed budget, capped at 25% of the
  // resting depth at the touch (never assume we get more than a quarter of it).
  const riskBudget = model.maxRiskPerTradeTicks ?? 50_000_000;
  const entry = maker?.bidTicks ?? askTicks ?? null;
  const perContractRisk = entry || 1;
  const depthCap = Math.floor(Math.min(book?.yesContractsAtTouch ?? 0, book?.noContractsAtTouch ?? 0) * 0.25);
  const budgetCap = Math.floor(riskBudget / perContractRisk);
  const contracts = Math.max(0, Math.min(budgetCap, depthCap));

  return {
    promote,
    // headline score: expected ticks of edge per contract on the promoted view
    score: bestEv !== null ? Math.round(bestEv / 1000) : 0,
    bestEvTicks: bestEv,
    maker,
    taker,
    coherence,
    contracts,
    gates,
    reasons,
    returnBps: retBps,
    selectivity: { minReturnBps, minShockOverSpread, minEdgeTicks: minEdge, maxSpreadTicks: maxSpread },
    inputs: {
      alertDeltaTicks: alert.deltaTicks,
      liquidityContracts: liq,
      spreadTicks: spread,
      minutesToClose: minutesToClose === null ? null : Math.round(minutesToClose * 10) / 10,
      takerMultiplier: modelMult,
      makerMultiplier: makerMult,
      siblingSumYesTicks: siblings?.sumYesTicks ?? null,
      siblingCount: siblings?.count ?? null
    }
  };
}

/**
 * Turn a promoted alert into concrete order intents for one strategy family.
 * Returns [] when the strategy has nothing to do.
 */
export function decideEntries(strategyId, { alert, market, book, score, model }) {
  const S = STRATEGIES[strategyId];
  if (!S || !score || !book) return [];
  if (!score.promote) return [];

  let side;
  let priceTicks;
  let fillsAs = S.fillsAs;

  if (S.needsGate === 'coherence') {
    if (!score.coherence || !score.coherence.promote) return [];
    side = score.coherence.side;
    priceTicks = side === 'yes' ? book.bestYesBid : book.bestNoBid;
  } else if (S.needsGate === 'taker') {
    if (!score.taker) return [];
    side = score.taker.side;
    priceTicks = score.taker.askTicks;
    fillsAs = 'taker';
  } else {
    if (!score.maker || !score.maker.promote) return [];
    side = score.maker.side;
    priceTicks = score.maker.bidTicks;
  }

  if (!priceTicks || priceTicks <= 0 || priceTicks >= T) return [];

  const contracts = Math.max(0, Math.min(score.contracts, Math.floor((side === 'yes' ? book.yesContracts : book.noContracts) * 0.25)));
  if (contracts <= 0) return [];

  return [
    {
      strategyId,
      side,
      priceTicks,
      contracts,
      fillsAs,
      takeProfitTicks: S.takeProfitTicks,
      stopTicks: S.stopTicks,
      maxHoldMs: S.maxHoldMs
    }
  ];
}

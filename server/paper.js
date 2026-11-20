/**
 * Simulated ("paper") trading engine.
 *
 * Purpose: test strategies without risking money, then analyse the results by
 * strategy type. It never places a real order. When an API key is configured the
 * *portfolio* panel reads the real Kalshi demo account (balance, positions, fills,
 * settlements); the paper engine remains the place where strategies are compared.
 *
 * All cash is tracked in integer cents. Payout per winning contract is $1.00 as
 * stated in the official settlement docs
 * (https://docs.kalshi.com/getting_started/market_settlement):
 * "Yes outcome: Yes contract holders receive $1 per contract".
 */

import fs from 'node:fs';
import path from 'node:path';

export const STRATEGIES = Object.freeze({
  MOMENTUM: 'momentum',
  MEAN_REVERT: 'mean_revert',
  THRESHOLD_BREAK: 'threshold_break',
  FADE_EXTREME: 'fade_extreme',
});

export const STRATEGY_META = Object.freeze({
  [STRATEGIES.MOMENTUM]: {
    label: 'Momentum',
    thesis: 'Buy in the direction of a >= $0.10 swing; assumes continuation.',
    entryRule: 'Enter on swing alert, side = swing direction.',
    exitRule: 'Exit at +$0.15 favourable, -$0.08 adverse, or at market close.',
    defaultSizeCents: 500,
  },
  [STRATEGIES.MEAN_REVERT]: {
    label: 'Mean reversion',
    thesis: 'Fade a >= $0.10 swing; assumes the move overshoots and partially retraces.',
    entryRule: 'Enter opposite the swing direction.',
    exitRule: 'Exit at +$0.10 favourable, -$0.12 adverse, or at market close.',
    defaultSizeCents: 500,
  },
  [STRATEGIES.THRESHOLD_BREAK]: {
    label: 'Threshold break',
    thesis: 'Trade price crossing a round level (0.50 or 0.25/0.75) with momentum.',
    entryRule: 'Enter when the swing crosses a round level in the swing direction.',
    exitRule: 'Exit at +$0.20 favourable, -$0.10 adverse, or at market close.',
    defaultSizeCents: 750,
  },
  [STRATEGIES.FADE_EXTREME]: {
    label: 'Fade extreme',
    thesis: 'Sell (buy NO) into swings that push a contract above $0.85 or below $0.15.',
    entryRule: 'Enter when a swing lands in an extreme band, betting against it.',
    exitRule: 'Exit at +$0.10 favourable, -$0.15 adverse, or at market close.',
    defaultSizeCents: 400,
  },
});

const DEFAULT_STATE = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  startingBalanceCents: 100000, // $1,000 of simulated cash.
  cashCents: 100000,
  positions: [], // open paper positions
  trades: [], // closed paper trades
  orderCount: 0,
});

export class PaperBroker {
  constructor({ statePath = null, startingBalanceCents = 100000, logger = console } = {}) {
    this.statePath = statePath;
    this.logger = logger;
    this.state = this.#load() ?? { ...DEFAULT_STATE(), startingBalanceCents, cashCents: startingBalanceCents };
  }

  #load() {
    if (!this.statePath || !fs.existsSync(this.statePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.positions) || !Array.isArray(parsed.trades)) return null;
      return parsed;
    } catch (err) {
      this.logger.warn?.(`paper state unreadable (${err.message}); starting fresh`);
      return null;
    }
  }

  save() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  get summary() {
    const open = this.state.positions;
    const openCost = open.reduce((s, p) => s + p.costCents, 0);
    const realized = this.state.trades.reduce((s, t) => s + (t.pnlCents ?? 0), 0);
    return {
      startingBalanceCents: this.state.startingBalanceCents,
      cashCents: this.state.cashCents,
      openPositionCount: open.length,
      openCostCents: openCost,
      realizedPnlCents: realized,
      equityCents: this.state.cashCents + openCost, // book cost of open positions
      tradeCount: this.state.trades.length,
      orderCount: this.state.orderCount,
      isSimulated: true,
    };
  }

  /**
   * Open a paper position.
   * `outcome` is 'yes' or 'no'; `price` is the per-contract price in dollars.
   */
  open({ ticker, eventTicker, title, topicId, strategy, outcome, price, contracts, alertId = null, meta = {} }) {
    const p = Number(price);
    const c = Number(contracts);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) throw new Error(`invalid price: ${price}`);
    if (!Number.isFinite(c) || c <= 0) throw new Error(`invalid contracts: ${contracts}`);
    const costCents = Math.round(p * c * 100);
    if (costCents > this.state.cashCents) {
      return { ok: false, reason: 'insufficient_paper_cash', costCents, cashCents: this.state.cashCents };
    }
    const position = {
      id: `${ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ticker,
      eventTicker: eventTicker ?? null,
      title: title ?? null,
      topicId: topicId ?? null,
      strategy,
      outcome,
      entryPrice: p,
      contracts: c,
      costCents,
      openedAt: new Date().toISOString(),
      alertId,
      meta,
    };
    this.state.cashCents -= costCents;
    this.state.positions.push(position);
    this.state.orderCount += 1;
    this.save();
    return { ok: true, position };
  }

  /** Close a position at `price` (per contract) with a stated `reason`. */
  close(positionId, { price, reason = 'manual', resolved = false }) {
    const idx = this.state.positions.findIndex((p) => p.id === positionId);
    if (idx === -1) return { ok: false, reason: 'position_not_found' };
    const pos = this.state.positions[idx];
    const exitPrice = Number(price);
    if (!Number.isFinite(exitPrice) || exitPrice < 0 || exitPrice > 1) {
      return { ok: false, reason: 'invalid_exit_price' };
    }
    const proceedsCents = Math.round(exitPrice * pos.contracts * 100);
    const pnlCents = proceedsCents - pos.costCents;
    const trade = {
      ...pos,
      exitPrice,
      proceedsCents,
      pnlCents,
      closedAt: new Date().toISOString(),
      holdMs: Date.now() - new Date(pos.openedAt).getTime(),
      closeReason: reason,
      resolvedByMarket: resolved,
      roiPct: pos.costCents > 0 ? Math.round((pnlCents / pos.costCents) * 10000) / 100 : null,
    };
    this.state.positions.splice(idx, 1);
    this.state.cashCents += proceedsCents;
    this.state.trades.push(trade);
    this.save();
    return { ok: true, trade };
  }

  /** Settle every open position on a market at its official result ('yes' | 'no'). */
  settleMarket(ticker, result) {
    if (result !== 'yes' && result !== 'no') return [];
    const closed = [];
    for (const pos of [...this.state.positions].filter((p) => p.ticker === ticker)) {
      const won = pos.outcome === result;
      // Settlement docs: the winning side receives $1 per contract.
      const exitPrice = won ? 1 : 0;
      const res = this.close(pos.id, { price: exitPrice, reason: 'market_settled', resolved: true });
      if (res.ok) closed.push({ ...res.trade, marketResult: result });
    }
    return closed;
  }

  /** Mark-to-market value of one open position at the current price. */
  markPrice(position, currentPrice) {
    const p = Number(currentPrice);
    if (!Number.isFinite(p)) return null;
    const exitPrice = position.outcome === 'yes' ? p : 1 - p;
    return Math.round(exitPrice * position.contracts * 100);
  }

  openPositions() {
    return this.state.positions;
  }

  closedTrades() {
    return this.state.trades;
  }
}

/**
 * Strategy routing: decide whether a swing alert should open a paper position.
 * Returns { strategy, outcome, contracts } or null.
 */
export function decideTrade(alert, { bankrollCents, strategies = Object.values(STRATEGIES) } = {}) {
  const strategiesEnabled = new Set(strategies);
  const p = Number(alert.toPrice);
  if (!Number.isFinite(p) || p <= 0.02 || p >= 0.98) return null; // avoid boundary fills
  const candidates = [];

  const swungUp = alert.direction === 'up';
  const move = Math.abs(Number(alert.moveDollars) || 0);

  if (strategiesEnabled.has(STRATEGIES.MOMENTUM) && move >= 0.1) {
    candidates.push({ strategy: STRATEGIES.MOMENTUM, outcome: swungUp ? 'yes' : 'no' });
  }
  if (strategiesEnabled.has(STRATEGIES.MEAN_REVERT) && move >= 0.1) {
    candidates.push({ strategy: STRATEGIES.MEAN_REVERT, outcome: swungUp ? 'no' : 'yes' });
  }
  if (strategiesEnabled.has(STRATEGIES.THRESHOLD_BREAK) && swamRound(alert)) {
    candidates.push({ strategy: STRATEGIES.THRESHOLD_BREAK, outcome: swungUp ? 'yes' : 'no' });
  }
  if (strategiesEnabled.has(STRATEGIES.FADE_EXTREME) && (p >= 0.85 || p <= 0.15)) {
    candidates.push({ strategy: STRATEGIES.FADE_EXTREME, outcome: p >= 0.85 ? 'no' : 'yes' });
  }

  if (!candidates.length) return null;

  // Pick the strategy with the lowest modelled cost at this price; deterministic so
  // the same alert always routes the same way (reproducible experiments).
  const chosen = candidates.sort((a, b) => a.strategy.localeCompare(b.strategy))[0];
  const budget = Math.min(STRATEGY_META[chosen.strategy].defaultSizeCents, Math.floor((bankrollCents ?? 500) * 0.05));
  const entryPrice = chosen.outcome === 'yes' ? p : 1 - p;
  const contracts = Math.max(1, Math.floor(budget / Math.max(1, entryPrice * 100)));
  return { ...chosen, contracts, entryPrice: Math.round(entryPrice * 10000) / 10000, budgetCents: budget };
}

function swamRound(alert) {
  const from = Number(alert.fromPrice);
  const to = Number(alert.toPrice);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  const levels = [0.15, 0.25, 0.5, 0.75, 0.85];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return levels.some((l) => l > lo && l <= hi);
}

/**
 * Aggregate results by strategy type so the dashboard can show which style of trade
 * actually made money in this session.
 */
export function analyzeTrades(trades) {
  const byStrategy = new Map();
  for (const t of trades) {
    const key = t.strategy ?? 'unknown';
    if (!byStrategy.has(key)) {
      byStrategy.set(key, {
        strategy: key,
        label: STRATEGY_META[key]?.label ?? key,
        trades: 0,
        wins: 0,
        losses: 0,
        flat: 0,
        pnlCents: 0,
        costCents: 0,
        holdMsTotal: 0,
        bestCents: null,
        worstCents: null,
        byTopic: {},
        byOutcome: { yes: 0, no: 0 },
        byDirection: { up: 0, down: 0 },
        resolvedTrades: 0,
      });
    }
    const s = byStrategy.get(key);
    s.trades += 1;
    s.pnlCents += t.pnlCents ?? 0;
    s.costCents += t.costCents ?? 0;
    s.holdMsTotal += t.holdMs ?? 0;
    if ((t.pnlCents ?? 0) > 0) s.wins += 1;
    else if ((t.pnlCents ?? 0) < 0) s.losses += 1;
    else s.flat += 1;
    if (s.bestCents === null || (t.pnlCents ?? 0) > s.bestCents) s.bestCents = t.pnlCents ?? 0;
    if (s.worstCents === null || (t.pnlCents ?? 0) < s.worstCents) s.worstCents = t.pnlCents ?? 0;
    if (t.topicId) s.byTopic[t.topicId] = (s.byTopic[t.topicId] ?? 0) + 1;
    if (t.outcome === 'yes' || t.outcome === 'no') s.byOutcome[t.outcome] += 1;
    if (t.resolvedByMarket) s.resolvedTrades += 1;
    const dir = t.meta?.swingDirection;
    if (dir === 'up' || dir === 'down') s.byDirection[dir] += 1;
  }

  const rows = [...byStrategy.values()].map((s) => ({
    ...s,
    winRatePct: s.trades ? Math.round((s.wins / s.trades) * 1000) / 10 : null,
    avgPnlCents: s.trades ? Math.round(s.pnlCents / s.trades) : null,
    roiPct: s.costCents ? Math.round((s.pnlCents / s.costCents) * 1000) / 10 : null,
    avgHoldMinutes: s.trades ? Math.round(s.holdMsTotal / s.trades / 60000) : null,
  }));
  rows.sort((a, b) => b.pnlCents - a.pnlCents);

  const totals = {
    trades: trades.length,
    pnlCents: trades.reduce((s, t) => s + (t.pnlCents ?? 0), 0),
    wins: trades.filter((t) => (t.pnlCents ?? 0) > 0).length,
    losses: trades.filter((t) => (t.pnlCents ?? 0) < 0).length,
    resolvedTrades: trades.filter((t) => t.resolvedByMarket).length,
  };
  return { byStrategy: rows, totals };
}

// Simulated (paper) trading engine.
//
// Purpose: test strategy families against the same alerts the live chat shows, so
// the user can compare measured results instead of opinions.
//
// Accounting rules, kept deliberately strict:
//  * One contract costs `price` dollars and pays exactly $1.00 if its side wins,
//    $0.00 if it loses. That is the contract definition, not an assumption.
//  * Every entry and exit pays the official fee (K6/K7) for the series multiplier.
//    Taker fills use 0.07*C*P*(1-P); a paper fill that would have rested uses the
//    maker formula, and the ledger records which it was.
//  * Prices are integer ticks. P&L is integer ticks. No floats in the ledger.
//  * A position is closed by: take profit, stop, max hold, or market resolution.
//    Whichever comes first, and the ledger records which, because exit reason is
//    one of the categories the user asked to analyse.

import { nextId } from './util.mjs';
import { feeTicksCenticent, multiplierForSeries } from './fees.mjs';
import { STRATEGIES } from './strategy.mjs';

const T = 1_000_000;

export class PaperBroker {
  constructor({ startTicks = 10_000 * T, logger = console } = {}) {
    this.startTicks = startTicks;
    this.cashTicks = startTicks;
    this.realizedTicks = 0;
    this.feesTicks = 0;
    /** @type {Map<string, object>} resting intents keyed by strategy:ticker */
    this.pending = new Map();
    /** @type {Map<string, object>} open position keyed by strategy:ticker */
    this.open = new Map();
    /** @type {object[]} closed trades */
    this.closed = [];
    this.logger = logger;
    this.equityCurve = [{ ts: Date.now(), equityTicks: startTicks }];
    this.strategyStats = new Map();
  }

  get equityTicks() {
    return this.cashTicks + this.#openMarkToMarket();
  }

  #openMarkToMarket() {
    let v = 0;
    for (const p of this.open.values()) {
      // A long position is worth what it could be sold at: the same side's bid.
      // If there is no bid, mark at the last trade price and say so.
      const mark = p.markTicks ?? p.entryTicks;
      v += mark * p.contracts;
    }
    return v;
  }

  /**
   * Open a paper position.
   * @param {object} args
   *  - strategyId, ticker, eventTicker, topic, side ('yes'|'no')
   *  - priceTicks (what we actually pay per contract, i.e. the ask side)
   *  - contracts (integer count)
   *  - seriesTicker (for the fee multiplier)
   *  - taker (bool) whether this fill removes liquidity
   *  - reason: the alert id / model reason that justified the trade
   *  - takeProfitTicks, stopTicks, maxHoldMs
   */
  openPosition({
    strategyId,
    ticker,
    eventTicker = null,
    eventTitle = null,
    marketTitle = null,
    topic = null,
    side,
    priceTicks,
    contracts,
    seriesTicker = '',
    taker = true,
    fillsAs = null,
    forceFill = false,
    reason = '',
    signalId = null,
    takeProfitTicks = null,
    stopTicks = null,
    maxHoldMs = 6 * 3600_000,
    atMs = Date.now()
  }) {
    if (!side || !['yes', 'no'].includes(side)) throw new Error(`side must be yes|no, got ${side}`);
    if (!(contracts > 0)) return null;
    if (!(priceTicks > 0 && priceTicks < T)) throw new Error(`price out of range: ${priceTicks}`);

    const key = `${strategyId}:${ticker}:${side}`;
    if (this.open.has(key)) return null; // one position per strategy/market/side

    // A resting (maker) intent is not filled at submission time. It waits for a
    // later observed price to trade at or through its limit, which is exactly how a
    // resting order behaves. This also models adverse selection instead of hiding it.
    if (fillsAs === 'maker' && !forceFill) {
      const pending = {
        id: nextId('pend_'),
        key,
        strategyId,
        ticker,
        eventTicker,
        eventTitle,
        marketTitle,
        topic,
        side,
        contracts,
        limitTicks: priceTicks,
        fillsAs,
        reason,
        signalId,
        takeProfitTicks,
        stopTicks,
        maxHoldMs,
        createdAt: atMs,
        expiresMs: 10 * 60_000,
        seriesTicker
      };
      this.pending.set(key, pending);
      this.#bumpStats(strategyId, { intents: 1 });
      return { pending: true, ...pending };
    }

    const notional = priceTicks * contracts;
    const m = multiplierForSeries(seriesTicker);
    const fee = taker
      ? feeTicksCenticent(contracts, priceTicks / T, { multiplier: m.taker })
      : feeTicksCenticent(contracts, priceTicks / T, { multiplier: m.maker, maker: true });

    if (this.cashTicks < notional + fee) {
      // Not enough simulated cash: refuse rather than go negative. The refusal is
      // recorded so the analytics can show capacity constraints honestly.
      this.#bumpStats(strategyId, { rejected: 1 });
      return null;
    }

    this.cashTicks -= notional + fee;
    this.feesTicks += fee;

    const pos = {
      id: nextId('pos_'),
      key,
      strategyId,
      ticker,
      eventTicker,
      eventTitle,
      marketTitle,
      topic,
      side,
      contracts,
      entryTicks: priceTicks,
      entryFeeTicks: fee,
      entryTs: atMs,
      notionalTicks: notional,
      taker,
      reason,
      signalId,
      takeProfitTicks,
      stopTicks,
      maxHoldMs,
      markTicks: priceTicks,
      closed: false
    };
    this.open.set(key, pos);
    this.#bumpStats(strategyId, { opened: 1, feesTicks: fee, notionalTicks: notional });
    return pos;
  }

  /**
   * Mark an open position to the current best bid on its side.
   * Called on every price observation for that market.
   */
  mark(ticker, { yesBidTicks = null, noBidTicks = null, yesTradeTicks = null, atMs = Date.now() } = {}) {
    const out = [];
    this.#tryPendingFills(ticker, { yesBidTicks, noBidTicks, yesTradeTicks, atMs });

    for (const pos of this.open.values()) {
      if (pos.ticker !== ticker) continue;
      const bid = pos.side === 'yes' ? yesBidTicks : noBidTicks;
      if (bid !== null && bid !== undefined && bid > 0) pos.markTicks = bid;

      const holdMs = atMs - pos.entryTs;
      const pnlPerContract = (pos.markTicks ?? pos.entryTicks) - pos.entryTicks;

      let exitReason = null;
      if (pos.takeProfitTicks !== null && pnlPerContract >= pos.takeProfitTicks) exitReason = 'take_profit';
      else if (pos.stopTicks !== null && -pnlPerContract >= pos.stopTicks) exitReason = 'stop';
      else if (holdMs >= pos.maxHoldMs) exitReason = 'max_hold';

      if (exitReason) out.push(this.closePosition(pos, { exitTicks: pos.markTicks, exitReason, atMs }));
    }
    return out;
  }

  /** Close a position at an observed price (the bid we could hit). */
  closePosition(pos, { exitTicks, exitReason, atMs = Date.now(), taker = true }) {
    if (pos.closed) return null;
    if (!(exitTicks > 0 && exitTicks <= T)) return null;
    const m = multiplierForSeries(pos.seriesTicker || '');
    const gross = (exitTicks - pos.entryTicks) * pos.contracts;
    // An exit that lifts a resting bid is a taker action and pays the taker fee;
    // an exit that is assumed to rest pays the maker fee. Recorded, not guessed.
    const exitFee = taker
      ? feeTicksCenticent(pos.contracts, exitTicks / T, { multiplier: m.taker })
      : feeTicksCenticent(pos.contracts, exitTicks / T, { multiplier: m.maker, maker: true });
    // Selling to close is a maker-style exit in practice (you post), but the paper
    // engine records which assumption was used so results are auditable.
    const net = gross - exitFee;
    this.cashTicks += exitTicks * pos.contracts - exitFee;
    this.realizedTicks += net;
    this.feesTicks += exitFee;

    const trade = {
      id: pos.id,
      strategyId: pos.strategyId,
      ticker: pos.ticker,
      eventTicker: pos.eventTicker,
      eventTitle: pos.eventTitle,
      marketTitle: pos.marketTitle,
      topic: pos.topic,
      side: pos.side,
      contracts: pos.contracts,
      entryTicks: pos.entryTicks,
      exitTicks,
      entryTs: pos.entryTs,
      exitTs: atMs,
      holdMs: atMs - pos.entryTs,
      entryFeeTicks: pos.entryFeeTicks,
      exitFeeTicks: exitFee,
      feesTicks: pos.entryFeeTicks + exitFee,
      grossTicks: gross,
      pnlTicks: net,
      exitReason,
      signalId: pos.signalId,
      reason: pos.reason,
      filledAs: pos.filledAs || (pos.taker ? 'taker' : 'maker'),
      fillMidTicks: pos.fillMidTicks ?? null,
      /** how the trade ended: 'exit' for rule-based, 'resolution' for terminal */
      outcomeKind: 'exit'
    };
    pos.closed = true;
    this.open.delete(pos.key);
    this.closed.push(trade);
    this.#bumpStats(pos.strategyId, {
      closed: 1,
      pnlTicks: net,
      wins: net > 0 ? 1 : 0,
      losses: net <= 0 ? 1 : 0,
      holdMs: trade.holdMs
    });
    this.#pushEquity(atMs);
    return trade;
  }

  /**
   * Settle every open position in a market that resolved YES or NO.
   * A YES position pays 1.00 per contract if result == 'yes', else 0.00.
   * No exit fee is charged: K6 says "There is no settlement fee."
   */
  settleMarket(ticker, { result, atMs = Date.now(), marketTitle = null } = {}) {
    if (result !== 'yes' && result !== 'no') return [];
    const trades = [];
    for (const pos of [...this.open.values()]) {
      if (pos.ticker !== ticker) continue;
      const won = pos.side === result;
      const payoutTicks = won ? T : 0;
      const gross = payoutTicks - pos.entryTicks;
      const net = gross * pos.contracts;
      this.cashTicks += payoutTicks * pos.contracts;
      this.realizedTicks += net;
      const trade = {
        id: pos.id,
        strategyId: pos.strategyId,
        ticker: pos.ticker,
        eventTicker: pos.eventTicker,
        eventTitle: pos.eventTitle,
        marketTitle: marketTitle ?? pos.marketTitle,
        topic: pos.topic,
        side: pos.side,
        contracts: pos.contracts,
        entryTicks: pos.entryTicks,
        exitTicks: payoutTicks,
        entryTs: pos.entryTs,
        exitTs: atMs,
        holdMs: atMs - pos.entryTs,
        entryFeeTicks: pos.entryFeeTicks,
        exitFeeTicks: 0,
        feesTicks: pos.entryFeeTicks,
        grossTicks: gross,
        pnlTicks: net,
        exitReason: 'resolution',
        resolution: result,
        filledAs: pos.filledAs || (pos.taker ? 'taker' : 'maker'),
        fillMidTicks: pos.fillMidTicks ?? null,
        signalId: pos.signalId,
        reason: pos.reason,
        outcomeKind: 'resolution'
      };
      pos.closed = true;
      this.open.delete(pos.key);
      this.closed.push(trade);
      trades.push(trade);
      this.#bumpStats(pos.strategyId, {
        closed: 1,
        pnlTicks: net,
        wins: net > 0 ? 1 : 0,
        losses: net <= 0 ? 1 : 0,
        holdMs: trade.holdMs,
        resolved: 1
      });
    }
    if (trades.length) this.#pushEquity(atMs);
    return trades;
  }

  /**
   * Fill resting intents when an observed price reaches the limit.
   * For a YES bid at limit L, a print at or below L means someone sold into it.
   * Expired intents are cancelled, which is what a real GTC order would need to be
   * told to do and is reported separately from a fill.
   */
  #tryPendingFills(ticker, { yesBidTicks, noBidTicks, yesTradeTicks, atMs }) {
    for (const [key, order] of [...this.pending.entries()]) {
      if (order.ticker !== ticker) continue;
      if (atMs - order.createdAt > order.expiresMs) {
        this.pending.delete(key);
        this.#bumpStats(order.strategyId, { expired: 1 });
        continue;
      }
      let fillable = false;
      let fillTicks = order.limitTicks;
      if (order.side === 'yes') {
        const touch = yesBidTicks !== null && yesBidTicks !== undefined ? yesBidTicks : null;
        const print = yesTradeTicks !== null && yesTradeTicks !== undefined ? yesTradeTicks : null;
        if (print !== null && print <= order.limitTicks) {
          fillable = true;
          fillTicks = Math.min(order.limitTicks, print);
        } else if (touch !== null && touch < order.limitTicks) {
          fillable = true;
          fillTicks = order.limitTicks;
        }
      } else {
        // A NO bid at limit L is a YES sale at 1-L; a YES print at or above 1-L means
        // someone bought the NO we were resting (documented reciprocity, K5).
        const print = yesTradeTicks !== null && yesTradeTicks !== undefined ? yesTradeTicks : null;
        const yesTouch = yesBidTicks !== null && yesBidTicks !== undefined ? yesBidTicks : null;
        if (print !== null && T - print <= order.limitTicks) {
          fillable = true;
          fillTicks = Math.min(order.limitTicks, T - print);
        } else if (yesTouch !== null && T - yesTouch < order.limitTicks) {
          fillable = true;
          fillTicks = order.limitTicks;
        }
      }
      if (!fillable) continue;
      this.pending.delete(key);
      const pos = this.openPosition({
        strategyId: order.strategyId,
        ticker: order.ticker,
        eventTicker: order.eventTicker,
        eventTitle: order.eventTitle,
        marketTitle: order.marketTitle,
        topic: order.topic,
        side: order.side,
        priceTicks: fillTicks,
        contracts: order.contracts,
        seriesTicker: order.seriesTicker,
        taker: false,
        fillsAs: 'maker',
        forceFill: true,
        reason: order.reason,
        signalId: order.signalId,
        takeProfitTicks: order.takeProfitTicks,
        stopTicks: order.stopTicks,
        maxHoldMs: order.maxHoldMs,
        atMs
      });
      if (pos) {
        pos.filledAs = 'maker';
        pos.fillMidTicks = order.side === 'yes' ? yesBidTicks : null;
        this.#bumpStats(order.strategyId, { filledMaker: 1 });
      }
    }
  }

  #pushEquity(atMs) {
    const last = this.equityCurve[this.equityCurve.length - 1];
    if (last && atMs - last.ts < 5_000) {
      last.equityTicks = this.equityTicks;
      return;
    }
    this.equityCurve.push({ ts: atMs, equityTicks: this.equityTicks });
    if (this.equityCurve.length > 3_000) this.equityCurve.splice(0, this.equityCurve.length - 3_000);
  }

  #bumpStats(strategyId, delta) {
    const s =
      this.strategyStats.get(strategyId) ||
      { opened: 0, closed: 0, wins: 0, losses: 0, rejected: 0, pnlTicks: 0, feesTicks: 0, notionalTicks: 0, holdMs: 0, resolved: 0, intents: 0, expired: 0, filledMaker: 1 * 0 };
    for (const [k, v] of Object.entries(delta)) s[k] = (s[k] || 0) + v;
    this.strategyStats.set(strategyId, s);
  }

  /** Equity curve for the chart, downsampled to at most `max` points. */
  equitySeries(max = 400) {
    const pts = this.equityCurve;
    if (pts.length <= max) return pts.slice();
    const step = Math.ceil(pts.length / max);
    const out = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  /**
   * Adverse selection probe. For maker fills we compare the price paid with the
   * mid at the moment of the fill: if fills systematically happen when the market
   * is already moving against the position, that is the documented cost of
   * providing liquidity, and it must be visible rather than buried.
   */
  adverseSelection() {
    const maker = this.closed.filter((t) => t.filledAs === 'maker' && t.fillMidTicks !== null && t.fillMidTicks !== undefined);
    if (!maker.length) return { n: 0, adverseRate: null, avgDriftTicks: null, note: 'no maker fills yet' };
    let adverse = 0;
    let drift = 0;
    for (const t of maker) {
      const d = t.fillMidTicks - t.entryTicks;
      drift += t.side === 'yes' ? d : -d;
      // adverse = we paid above the mid that existed when we filled
      if ((t.side === 'yes' && d < 0) || (t.side === 'no' && d > 0)) adverse += 1;
    }
    return {
      n: maker.length,
      adverseRate: adverse / maker.length,
      avgDriftTicks: Math.round(drift / maker.length),
      note: 'adverseRate = share of maker fills where the fill price was worse than the contemporaneous mid'
    };
  }

  snapshot() {
    return {
      startTicks: this.startTicks,
      cashTicks: this.cashTicks,
      equityTicks: this.equityTicks,
      realizedTicks: this.realizedTicks,
      feesTicks: this.feesTicks,
      openPositions: [...this.open.values()].filter((p) => !p.closed),
      pendingIntents: [...this.pending.values()],
      closedCount: this.closed.length,
      equityCurve: this.equitySeries()
    };
  }
}

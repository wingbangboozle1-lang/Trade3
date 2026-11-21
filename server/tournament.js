/**
 * Shadow strategy tournament.
 *
 * The dashboard already opens ONE paper trade per high-ROI alert. That is useful
 * for proving the plumbing, but it cannot answer the question the brief actually
 * asks: "automate simulated trades to test DIFFERENT strategies, and categorise
 * the results by the type of trade."
 *
 * This module answers it without an API key, without manual input, and without
 * inventing data. For every swing the collector detects it opens the SAME swing
 * in every strategy's shadow book, each at the price that side would really have
 * paid, and settles nothing until Kalshi publishes a result. The strategies end up
 * trading an identical event stream, so the comparison is like-for-like.
 *
 * Pricing rules (the only ones that need justifying, and they are the exchange's):
 *   - A YES buy pays the YES ask.
 *   - A NO  buy pays (1 - best YES bid), because "a bid for yes at price X is
 *     equivalent to an ask for no at (1 - X)" —
 *     https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *   - Settlement pays $1.00 per winning contract —
 *     https://docs.kalshi.com/getting_started/market_settlement
 *   - Fees are NOT charged, because the demo environment's fee behaviour is not
 *     something this project can verify without placing live demo orders. Every
 *     result says so, so nobody mistakes these numbers for net-of-fee P&L.
 *
 * Anything the exchange did not publish stays null: no spread means the trade is
 * skipped and counted as a skip with a reason, never filled at a guessed price.
 */

import { STRATEGY_META, STRATEGIES } from './paper.js';

export const TOURNAMENT_SIZE_CENTS = 1000;      // $10 of notional per shadow trade.
export const SETTLEMENT_PAYOUT_CENTS = 100;     // $1.00 per contract, per the settlement docs.

export const SHADOW_STRATEGIES = Object.freeze([
  {
    id: STRATEGIES.MOMENTUM,
    label: STRATEGY_META[STRATEGIES.MOMENTUM].label,
    thesis: STRATEGY_META[STRATEGIES.MOMENTUM].thesis,
    rule: 'Follow the ≥ $0.10 swing.',
    decide: ({ swing }) => ({ side: swing.delta > 0 ? 'yes' : 'no', why: 'followed the swing' }),
  },
  {
    id: STRATEGIES.MEAN_REVERT,
    label: STRATEGY_META[STRATEGIES.MEAN_REVERT].label,
    thesis: STRATEGY_META[STRATEGIES.MEAN_REVERT].thesis,
    rule: 'Fade the ≥ $0.10 swing.',
    decide: ({ swing }) => ({ side: swing.delta > 0 ? 'no' : 'yes', why: 'faded the swing' }),
  },
  {
    id: STRATEGIES.THRESHOLD_BREAK,
    label: STRATEGY_META[STRATEGIES.THRESHOLD_BREAK].label,
    thesis: STRATEGY_META[STRATEGIES.THRESHOLD_BREAK].thesis,
    rule: 'Follow only swings that cross $0.25, $0.50 or $0.75.',
    decide: ({ swing }) => {
      const levels = [0.25, 0.5, 0.75];
      const crossed = levels.some((l) => (swing.from - l) * (swing.to - l) < 0 || swing.to === l);
      if (!crossed) return { side: null, why: 'no round level crossed' };
      return { side: swing.delta > 0 ? 'yes' : 'no', why: 'crossed a round level' };
    },
  },
  {
    id: STRATEGIES.FADE_EXTREME,
    label: STRATEGY_META[STRATEGIES.FADE_EXTREME].label,
    thesis: STRATEGY_META[STRATEGIES.FADE_EXTREME].thesis,
    rule: 'Fade only swings that land above $0.85 or below $0.15.',
    decide: ({ swing }) => {
      if (swing.to > 0.85) return { side: 'no', why: 'landed above $0.85' };
      if (swing.to < 0.15) return { side: 'yes', why: 'landed below $0.15' };
      return { side: null, why: 'not in an extreme band' };
    },
  },
]);

/** Price one side at the quote the buyer would actually pay, or null if no quote. */
export function entryPriceCents({ side, yesBidDollars, yesAskDollars }) {
  const bid = toCents(yesBidDollars);
  const ask = toCents(yesAskDollars);
  if (side === 'yes') return ask == null || ask <= 0 || ask >= 100 ? null : ask;
  // Buying NO is selling YES at the opposite side's price: 1 - best YES bid.
  if (bid == null) return null;
  const price = 100 - bid;
  return price > 0 && price < 100 ? price : null;
}

function toCents(dollars) {
  if (dollars == null || dollars === '') return null;
  const f = typeof dollars === 'number' ? dollars : Number.parseFloat(dollars);
  return Number.isFinite(f) ? Math.round(f * 100) : null;
}

export class StrategyTournament {
  constructor({ strategies = SHADOW_STRATEGIES, sizeCents = TOURNAMENT_SIZE_CENTS } = {}) {
    this.strategies = strategies;
    this.sizeCents = sizeCents;
    this.books = new Map(strategies.map((s) => [s.id, emptyBook(s)]));
    this.open = [];          // every shadow position still waiting for a result
    this.eventCount = 0;
    this.lastEventAt = null;
  }

  /**
   * Offer one detected swing to every strategy.
   *
   * @param {object} o
   * @param {{ticker,title,topicId,from,to,delta,at}} o.swing
   * @param {{yesBidDollars, yesAskDollars}} o.quote  the book at alert time
   */
  onSwing({ swing, quote }) {
    if (!swing || !swing.ticker) return [];
    this.eventCount++;
    this.lastEventAt = swing.at || Date.now();
    const opened = [];

    for (const strategy of this.strategies) {
      const decision = strategy.decide({ swing });
      const book = this.books.get(strategy.id);
      book.events++;
      if (!decision.side) {
        book.skips++;
        book.skipReasons[decision.why] = (book.skipReasons[decision.why] || 0) + 1;
        continue;
      }
      const priceCents = entryPriceCents({ side: decision.side, ...quote });
      if (priceCents == null) {
        book.skips++;
        book.skipReasons['no usable quote on that side'] = (book.skipReasons['no usable quote on that side'] || 0) + 1;
        continue;
      }
      const count = Math.floor(this.sizeCents / priceCents);   // whole contracts only
      if (count <= 0) {
        book.skips++;
        book.skipReasons['size too small for one contract'] = (book.skipReasons['size too small for one contract'] || 0) + 1;
        continue;
      }
      const costCents = count * priceCents;
      const position = {
        id: `${strategy.id}:${swing.ticker}:${this.eventCount}`,
        strategy: strategy.id,
        ticker: swing.ticker,
        title: swing.title || swing.ticker,
        topicId: swing.topicId || null,
        side: decision.side,
        entryCents: priceCents,
        count,
        costCents,
        openedAt: swing.at || Date.now(),
        swingDelta: swing.delta,
        swingFrom: swing.from,
        swingTo: swing.to,
        why: decision.why,
        result: null,
        pnlCents: null,
      };
      book.positions.push(position);
      this.open.push(position);
      opened.push(position);
    }
    return opened;
  }

  /**
   * Settle every open shadow position in a market whose result the exchange has
   * published. Nothing is settled on an estimate.
   */
  settle({ ticker, result }) {
    if (result !== 'yes' && result !== 'no') return [];
    const settled = [];
    const stillOpen = [];
    for (const p of this.open) {
      if (p.ticker !== ticker) { stillOpen.push(p); continue; }
      const won = p.side === result;
      const payoutCents = won ? p.count * SETTLEMENT_PAYOUT_CENTS : 0;
      p.result = result;
      p.payoutCents = payoutCents;
      p.pnlCents = payoutCents - p.costCents;
      p.settledAt = Date.now();
      const book = this.books.get(p.strategy);
      book.settled++;
      book.wins += won ? 1 : 0;
      book.losses += won ? 0 : 1;
      book.pnlCents += p.pnlCents;
      book.turnoverCents += p.costCents;
      settled.push(p);
    }
    this.open = stillOpen;
    return settled;
  }

  /** Per-strategy results, the categorisation the brief asks for. */
  report() {
    const rows = [...this.books.values()].map((b) => {
      const decided = b.wins + b.losses;
      return {
        strategy: b.id,
        label: b.label,
        thesis: b.thesis,
        rule: b.rule,
        eventsSeen: b.events,
        opened: b.positions.length,
        skips: b.skips,
        skipReasons: { ...b.skipReasons },
        settled: b.settled,
        openPositions: b.positions.length - b.settled,
        wins: b.wins,
        losses: b.losses,
        // Null, never 0 or 100, until at least one position has actually been decided.
        hitRate: decided ? Math.round((b.wins / decided) * 1000) / 1000 : null,
        pnlCents: b.settled ? b.pnlCents : null,
        turnoverCents: b.turnoverCents || null,
        // Per-contract edge so strategies that sized differently stay comparable.
        avgPnlPerContractCents: avgPerContract(b.positions),
        byTopic: countBy(b.positions, (p) => p.topicId || 'unknown'),
        bySide: countBy(b.positions, (p) => p.side),
        bySwingDirection: countBy(b.positions, (p) => (p.swingDelta > 0 ? 'up' : 'down')),
      };
    });
    // Rank only strategies that have at least one settled position. A strategy
    // that has traded nothing is not compared: putting it in the list would imply
    // it had a result of $0.00, which it does not.
    const decidedRows = rows.filter((r) => r.settled > 0);
    const ranked = [...decidedRows].sort((a, b) => (b.pnlCents ?? -Infinity) - (a.pnlCents ?? -Infinity));
    return {
      strategies: rows,
      ranking: ranked.map((r) => r.strategy),
      leader: ranked.length ? ranked[0].strategy : null,
      sizeCents: this.sizeCents,
      eventsSeen: this.eventCount,
      lastEventAt: this.lastEventAt,
      openPositions: this.open.length,
      note: 'Simulated only. No fees are charged and no order is sent. A strategy with no '
        + 'settled positions has a null P&L, not a zero — nothing is filled in.',
      settlementDocs: 'https://docs.kalshi.com/getting_started/market_settlement',
      pricingDocs: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
    };
  }

  /** Flat rows for the UI table, newest first. */
  trades(limit = 200) {
    // Spread the Map's iterator into an array first: Iterator.prototype.flatMap
    // (iterator helpers) is Node 22+, but CI runs Node 20 — calling flatMap
    // directly on the iterator threw "is not a function" there (found by the
    // smoke-test watchdog, 2026-11-21).
    return [...this.open, ...[...this.books.values()].flatMap((b) => b.positions.filter((p) => p.result))]
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, limit);
  }

  toJSON() {
    return { report: this.report(), trades: this.trades() };
  }
}

function emptyBook(s) {
  return {
    id: s.id, label: s.label, thesis: s.thesis, rule: s.rule,
    events: 0, skips: 0, skipReasons: {},
    positions: [], settled: 0, wins: 0, losses: 0,
    pnlCents: 0, turnoverCents: 0,
  };
}

function avgPerContract(positions) {
  const settled = positions.filter((p) => p.pnlCents != null);
  if (!settled.length) return null;
  const pnl = settled.reduce((a, p) => a + p.pnlCents, 0);
  const contracts = settled.reduce((a, p) => a + p.count, 0);
  return contracts ? Math.round((pnl / contracts) * 1000) / 1000 : null;
}

function countBy(positions, key) {
  const out = {};
  for (const p of positions) {
    const k = key(p);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

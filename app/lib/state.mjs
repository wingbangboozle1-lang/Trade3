// In-memory state for the live dashboard.
//
// Bounded on purpose: this process is meant to run for days. Every buffer has a
// hard cap and drops the oldest point, and the caps are configurable in config.mjs.
//
// Nothing here is persisted to Git. Optional JSONL persistence is written to
// app/data (git-ignored) so a restart can replay the resolution log.

import { config } from '../config.mjs';

export class MarketIndex {
  constructor({ pricePointsPerMarket = config.budget.pricePointsPerMarket } = {}) {
    /** @type {Map<string, object>} */
    this.markets = new Map();
    this.maxPoints = pricePointsPerMarket;
  }

  upsert(market) {
    const ticker = market.ticker;
    if (!ticker) return null;
    let m = this.markets.get(ticker);
    if (!m) {
      m = {
        ticker,
        eventTicker: market.eventTicker || '',
        seriesTicker: market.seriesTicker || '',
        title: market.title || '',
        subtitle: market.subtitle || '',
        topic: market.topic || null,
        topicReason: market.topicReason || null,
        topicConfidence: market.topicConfidence || null,
        status: market.status || 'open',
        closeSec: market.closeSec || null,
        openSec: market.openSec || null,
        // live values (ticks / contract counts)
        yesBidTicks: null,
        yesAskTicks: null,
        lastTicks: null,
        prevCloseTicks: null,
        yesBidSize: null,
        yesAskSize: null,
        volumeContracts: null,
        volume24hContracts: null,
        openInterestContracts: null,
        dollarVolume: null,
        liquidityTicks: null,
        result: market.result || '',
        settlementValueTicks: null,
        settlementTs: null,
        determinedTs: null,
        rulesPrimary: market.rulesPrimary || '',
        // chart + book
        points: [], // {ts, ticks} bounded
        book: null, // {yesLevels:[{ticks,count}], noLevels:[], ts, source}
        lastTrade: null,
        lastUpdateTs: null,
        firstSeenTs: Date.now(),
        updateCount: 0
      };
      this.markets.set(ticker, m);
      return m;
    }
    // never overwrite a live field with undefined
    for (const [k, v] of Object.entries(market)) {
      if (v === undefined) continue;
      if (k === 'ticker') continue;
      if (k === 'topic' && m.topic && !v) continue; // do not lose a classification
      m[k] = v;
    }
    return m;
  }

  get(ticker) {
    return this.markets.get(ticker) || null;
  }

  setPrice(ticker, ticks, tsMs) {
    const m = this.markets.get(ticker);
    if (!m) return;
    if (ticks === null || ticks === undefined) return;
    m.lastTicks = ticks;
    m.lastUpdateTs = tsMs || Date.now();
    m.updateCount += 1;
    const pts = m.points;
    const last = pts[pts.length - 1];
    if (!last || last.ticks !== ticks) {
      pts.push({ ts: m.lastUpdateTs, ticks });
      if (pts.length > this.maxPoints) pts.splice(0, pts.length - this.maxPoints);
    } else if (last) {
      last.ts = m.lastUpdateTs;
    }
  }

  setBook(ticker, book) {
    const m = this.markets.get(ticker);
    if (!m) return;
    m.book = book;
  }

  byTopic(topicId) {
    return [...this.markets.values()].filter((m) => m.topic === topicId);
  }

  openMarkets() {
    return [...this.markets.values()].filter((m) => m.status === 'open' || m.status === 'initialized' || m.status === 'closed');
  }

  resolvedMarkets() {
    return [...this.markets.values()].filter((m) => m.result === 'yes' || m.result === 'no');
  }

  /**
   * "Highest dollar amount live events": rank events by the dollar volume actually
   * reported by Kalshi. Priority of evidence:
   *   1. `dollar_volume` from the ticker channel (K18) — whole dollars, cumulative.
   *   2. volume_fp * last price from REST (K9) — our own multiplication, labelled.
   *   3. liquidity_dollars as reported (K9) — a different metric, labelled.
   * Events with none of these are excluded rather than assigned a zero.
   */
  rankEvents({ limit = 25, topic = null, windowMs = null } = {}) {
    const byEvent = new Map();
    for (const m of this.markets.values()) {
      if (topic && m.topic !== topic) continue;
      if (m.status === 'settled') continue;
      const key = m.eventTicker || m.ticker;
      let ev = byEvent.get(key);
      if (!ev) {
        ev = {
          eventTicker: key,
          eventTitle: m.title,
          topic: m.topic,
          markets: [],
          dollarVolume: null,
          dollarVolumeBasis: null,
          liquidityTicks: null,
          openInterest: null,
          volume: null,
          closesAt: null,
          resolved: null
        };
        byEvent.set(key, ev);
      }
      ev.markets.push(m);
      if (m.dollarVolume !== null && m.dollarVolume !== undefined) {
        ev.dollarVolume = (ev.dollarVolume ?? 0) + m.dollarVolume;
        ev.dollarVolumeBasis = 'reported dollar_volume';
      } else if (m.volumeContracts && m.lastTicks) {
        // Mark the basis so nobody mistakes it for the reported number.
        const est = (m.volumeContracts * m.lastTicks) / 1_000_000;
        ev.dollarVolume = (ev.dollarVolume ?? 0) + est;
        ev.dollarVolumeBasis = ev.dollarVolumeBasis || 'volume x price (derived)';
      }
      if (m.liquidityTicks !== null && m.liquidityTicks !== undefined) {
        ev.liquidityTicks = (ev.liquidityTicks ?? 0) + m.liquidityTicks;
      }
      if (m.openInterestContracts !== null && m.openInterestContracts !== undefined) {
        ev.openInterest = (ev.openInterest ?? 0) + m.openInterestContracts;
      }
      if (m.volumeContracts !== null && m.volumeContracts !== undefined) {
        ev.volume = (ev.volume ?? 0) + m.volumeContracts;
      }
      if (m.closeSec && (!ev.closesAt || m.closeSec < ev.closesAt)) ev.closesAt = m.closeSec;
      if (m.result === 'yes' || m.result === 'no') ev.resolved = m.result;
    }
    const list = [...byEvent.values()].filter((e) => e.dollarVolume !== null);
    list.sort((a, b) => {
      if (b.dollarVolume !== a.dollarVolume) return b.dollarVolume - a.dollarVolume;
      if ((b.openInterest ?? 0) !== (a.openInterest ?? 0)) return (b.openInterest ?? 0) - (a.openInterest ?? 0);
      return a.eventTicker.localeCompare(b.eventTicker);
    });
    void windowMs;
    return list.slice(0, limit);
  }

  snapshot() {
    return {
      markets: [...this.markets.values()].map((m) => ({
        ticker: m.ticker,
        eventTicker: m.eventTicker,
        seriesTicker: m.seriesTicker,
        title: m.title,
        subtitle: m.subtitle,
        topic: m.topic,
        topicReason: m.topicReason,
        status: m.status,
        closeSec: m.closeSec,
        yesBidTicks: m.yesBidTicks,
        yesAskTicks: m.yesAskTicks,
        lastTicks: m.lastTicks,
        volumeContracts: m.volumeContracts,
        openInterestContracts: m.openInterestContracts,
        dollarVolume: m.dollarVolume,
        liquidityTicks: m.liquidityTicks,
        result: m.result,
        settlementValueTicks: m.settlementValueTicks,
        lastUpdateTs: m.lastUpdateTs
      })),
      count: this.markets.size
    };
  }
}

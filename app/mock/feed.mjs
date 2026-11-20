// Feeder that drives MockExchange and emits WS-shaped messages on a timer, so the
// real ingest path (handleWsMessage -> onObservation -> alert -> paper trade) runs
// unchanged against the simulator.
//
// Set MOCK_INTERVAL_MS to speed up or slow down the synthetic market.

import { EventEmitter } from 'node:events';
import { MockExchange } from './exchange.mjs';

export class KxMockFeed extends EventEmitter {
  constructor({ seed = 11, intervalMs = 700 } = {}) {
    super();
    this.exchange = new MockExchange({ seed, shockEveryMs: Math.max(3_000, intervalMs * 8) });
    this.intervalMs = intervalMs;
    this.timer = null;
    this.ticks = 0;
    this.startedAt = null;
    this.lastError = null;
  }

  start() {
    this.startedAt = Date.now();
    this.emit('ready');
    this.timer = setInterval(() => {
      try {
        const msgs = this.exchange.step(Date.now());
        this.ticks += 1;
        if (msgs.length) this.emit('messages', msgs);
      } catch (err) {
        this.lastError = err.message;
        this.emit('error', err);
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  markets() {
    return this.exchange.markets.map((m) => ({
      ticker: m.ticker,
      eventTicker: m.event_ticker,
      seriesTicker: m.series_ticker,
      title: m.title,
      subtitle: m.subtitle,
      status: m.status,
      closeSec: m.closeSec,
      openSec: m.openSec,
      yesBidTicks: m.yesBidTicks,
      yesAskTicks: m.yesAskTicks,
      lastTicks: m.lastTicks,
      volumeContracts: m.volume,
      volume24hContracts: m.volume24h,
      openInterestContracts: m.openInterest,
      dollarVolume: Math.round((m.volume * m.lastTicks) / 1_000_000),
      liquidityTicks: m.liquidityTicks,
      result: m.result || '',
      settlementValueTicks: m.settlementValueTicks,
      settlementTs: m.settlementTs,
      rulesPrimary: 'Synthetic fixture — not a real Kalshi market.'
    }));
  }

  events() {
    return this.exchange.events;
  }

  book(ticker) {
    const b = this.exchange.books.get(ticker);
    if (!b) return null;
    return { yes_dollars: [...b.yes_dollars], no_dollars: [...b.no_dollars] };
  }

  status() {
    return {
      connected: Boolean(this.timer),
      kind: 'simulated',
      tickMs: this.intervalMs,
      ticks: this.ticks,
      startedAt: this.startedAt,
      lastError: this.lastError
    };
  }
}

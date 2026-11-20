// Swing detection: flag any move >= threshold ($0.10 by default) on a market's
// contract price, in either direction, from the price stream we actually observed.
//
// Design notes tied to the docs:
//  * The `ticker` WebSocket channel is "combined and sent on a flush scheduled every
//    second ... intermediate values are not sent" (K18). So a 10c spike can happen
//    entirely between two ticker messages. The primary input here is therefore the
//    `trade` channel (every print, K19), with ticker snapshots as a secondary input.
//  * Prices are integer ticks (1e-6 dollars). Comparisons are exact; no float math.
//  * Two detectors run:
//      1. PRINT: consecutive observed prices differ by >= threshold.
//      2. DRIFT: price now vs price `driftWindowMs` ago differs by >= threshold
//         (catches a slow 10c creep built from many small prints).
//    A single 10c move therefore produces at most one alert per detector window,
//    and the cooldown stops a fast leg from spamming the chat.
//  * Every alert stores which stream and which two observations produced it, so a
//    reviewer can audit it. Nothing is synthesised.

import { nextId } from './util.mjs';

export class AlertEngine {
  constructor({
    thresholdTicks = 100_000, // $0.10
    cooldownMs = 15_000,
    driftWindowMs = 300_000,
    minLiquidityContracts = 1,
    historyMs = 900_000,
    logger = console
  } = {}) {
    this.thresholdTicks = thresholdTicks;
    this.cooldownMs = cooldownMs;
    this.driftWindowMs = driftWindowMs;
    this.minLiquidityContracts = minLiquidityContracts;
    this.historyMs = historyMs;
    this.logger = logger;

    /** @type {Map<string, {ts:number, ticks:number, source:string, size:number}[]>} */
    this.history = new Map();
    /** @type {Map<string, number>} last alert timestamp per market */
    this.lastAlertAt = new Map();
    this.alerts = [];
    this.seq = 0;
  }

  /** Record an observation. Returns an alert object when one is produced. */
  observe({ ticker, ticks, tsMs, source = 'trade', size = 0, liquidity = null, priceSource = 'yes' }) {
    if (ticks === null || ticks === undefined || !Number.isFinite(ticks)) return null;
    if (ticks <= 0 || ticks >= 1_000_000) return null; // outside $0..$1 is not a price

    const ts = Number(tsMs) || Date.now();
    let buf = this.history.get(ticker);
    if (!buf) {
      buf = [];
      this.history.set(ticker, buf);
    }
    const prev = buf.length ? buf[buf.length - 1] : null;

    // Ignore exact repeats: they carry no information and would reset cooldowns.
    if (prev && prev.ticks === ticks) {
      prev.ts = ts;
      return null;
    }

    buf.push({ ts, ticks, source, size, priceSource });
    // Trim outside the drift window (keep one extra point so a drift comparison
    // always has an "older" anchor available).
    const cutoff = ts - this.historyMs;
    while (buf.length > 2 && buf[0].ts < cutoff) buf.shift();

    let alert = null;

    // --- detector 1: single print move ------------------------------------
    if (prev) {
      const delta = ticks - prev.ticks;
      if (Math.abs(delta) >= this.thresholdTicks) {
        alert = this.#makeAlert({
          kind: 'print',
          ticker,
          from: prev,
          to: { ts, ticks, source, size },
          delta,
          liquidity
        });
      }
    }

    // --- detector 2: swing within the drift window -------------------------
    // Compares the current price with the most extreme price observed inside the
    // window (the window low for an up move, the window high for a down move). That
    // catches a slow creep and a round trip that no single print would reveal, and it
    // only ever uses prices we actually observed, so it cannot fabricate a move.
    if (!alert) {
      const windowStart = ts - this.driftWindowMs;
      let lowest = null;
      let highest = null;
      for (const p of buf) {
        if (p === buf[buf.length - 1]) continue;
        if (p.ts < windowStart) continue;
        if (!lowest || p.ticks < lowest.ticks) lowest = p;
        if (!highest || p.ticks > highest.ticks) highest = p;
      }
      if (highest && ticks - lowest.ticks >= this.thresholdTicks) {
        alert = this.#makeAlert({
          kind: 'drift',
          ticker,
          from: lowest,
          to: { ts, ticks, source, size },
          delta: ticks - lowest.ticks,
          liquidity,
          windowMs: ts - lowest.ts
        });
      } else if (lowest && ticks - highest.ticks <= -this.thresholdTicks) {
        alert = this.#makeAlert({
          kind: 'drift',
          ticker,
          from: highest,
          to: { ts, ticks, source, size },
          delta: ticks - highest.ticks,
          liquidity,
          windowMs: ts - highest.ts
        });
      }
    }

    if (!alert) return null;

    const last = this.lastAlertAt.get(ticker) || 0;
    if (ts - last < this.cooldownMs) return null;
    this.lastAlertAt.set(ticker, ts);
    this.alerts.push(alert);
    if (this.alerts.length > 5000) this.alerts.splice(0, this.alerts.length - 5000);
    return alert;
  }

  #makeAlert({ kind, ticker, from, to, delta, liquidity, windowMs }) {
    this.seq += 1;
    const dir = delta > 0 ? 'up' : 'down';
    return {
      id: nextId('al_'),
      seq: this.seq,
      kind,
      ticker,
      direction: dir,
      fromTicks: from.ticks,
      toTicks: to.ticks,
      deltaTicks: delta,
      fromTs: from.ts,
      toTs: to.ts,
      windowMs: windowMs ?? to.ts - from.ts,
      source: to.source,
      size: to.size ?? null,
      liquidity,
      // Filled in by the app layer once the market/event context is known:
      eventTicker: null,
      eventTitle: null,
      marketTitle: null,
      topic: null,
      topicReason: null,
      score: null,
      highRoi: false,
      causes: []
    };
  }

  /** Recent alerts, newest last (chat order). */
  recent(limit = 200, filter = null) {
    const list = filter ? this.alerts.filter(filter) : this.alerts;
    return list.slice(-limit);
  }

  seriesFor(ticker) {
    return this.history.get(ticker) || [];
  }

  stats() {
    return {
      marketsTracked: this.history.size,
      observations: [...this.history.values()].reduce((n, b) => n + b.length, 0),
      alerts: this.alerts.length,
      thresholdTicks: this.thresholdTicks,
      cooldownMs: this.cooldownMs,
      driftWindowMs: this.driftWindowMs
    };
  }
}

/** Convenience: build the engine from config. */
export function makeAlertEngine(cfg) {
  return new AlertEngine({
    thresholdTicks: Math.round(cfg.alert.moveDollars * 1_000_000),
    cooldownMs: cfg.alert.cooldownMs,
    driftWindowMs: cfg.alert.driftWindowMs,
    minLiquidityContracts: cfg.alert.minLiquidityContracts
  });
}

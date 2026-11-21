/**
 * Market collector: polls the Kalshi demo Trade API, keeps a price/orderbook history
 * for the five requested topics, runs the swing detector, tracks resolution, and
 * drives the simulated trading engine.
 *
 * Data-source honesty: every value that reaches the UI carries a `dataMode`:
 *   'live'     - read from the Kalshi demo API during this run
 *   'snapshot' - read from a committed capture of the demo API (timestamped)
 *   'demo'     - synthetic values generated locally for UI demonstration
 * Nothing is ever silently substituted.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { KalshiClient, topOfBook, midPrice, liquidity, round4 } from './kalshi.js';
import { TOPICS, classifyMarket, kalshiMarketUrl, seriesMeta } from './topics.js';
import { SwingDetector, roiScore, moveDollars, SWING_THRESHOLD_DOLLARS, HIGH_ROI_MIN_SCORE } from './alerts.js';
import { PaperBroker, decideTrade, analyzeTrades, STRATEGY_META, STRATEGIES } from './paper.js';
import { StrategyTournament } from './tournament.js';
import { syntheticMarkets, syntheticBook, SYNTHETIC_SERIES, DEMO_MODE_NOTICE } from './demo-data.js';

// Categories that actually exist on Kalshi (verified against GET /series?category=...).
// "Gas" and "Golf" are NOT categories: gas lives in Economics with an "Oil & Gas" tag,
// golf lives in Sports with a "Golf" tag. "Culture" IS a category (verified 2026-11-20:
// GET /series?category=Culture returns series), even though /search/tags_by_categories
// omits it. Both findings are recorded on the Flagged for Review pages.
export const SERIES_CATEGORIES = ['Crypto', 'Elections', 'Culture', 'Sports', 'Economics', 'Politics', 'Entertainment', 'Financials'];

export class Collector extends EventEmitter {
  constructor({
    env = 'demo',
    dataDir = path.join(process.cwd(), 'data'),
    pollIntervalMs = 15000,
    maxMarketPages = 6,
    trackedPerTopic = 12,
    orderbookConcurrency = 4,
    enablePaperTrading = true,
    strategies = Object.values(STRATEGIES),
    logger = console,
    client = null,
    dataMode = 'live', // 'live' | 'snapshot' | 'demo'
    allowDemoFallback = true,
  } = {}) {
    super();
    this.setMaxListeners(50);
    this.logger = logger;
    this.env = env;
    this.dataDir = dataDir;
    this.pollIntervalMs = pollIntervalMs;
    this.maxMarketPages = maxMarketPages;
    this.trackedPerTopic = trackedPerTopic;
    this.orderbookConcurrency = orderbookConcurrency;
    this.enablePaperTrading = enablePaperTrading;
    this.strategies = strategies;
    this.requestedMode = dataMode;
    this.allowDemoFallback = allowDemoFallback;
    this.effectiveMode = dataMode;
    this.snapshot = null;

    this.client = client ?? new KalshiClient({ env, onLog: (lvl, msg) => this.logger[lvl]?.(msg) });
    this.detector = new SwingDetector({ threshold: SWING_THRESHOLD_DOLLARS });
    // Every detected swing is also offered to all four shadow strategies at the
    // same quote, so their results are comparable. Nothing here sends an order.
    this.tournament = new StrategyTournament();
    this.paper = new PaperBroker({
      statePath: path.join(dataDir, 'paper-state.json'),
      logger,
    });

    this.markets = new Map();
    this.alerts = []; // all swings, newest first
    this.modelAlerts = []; // subset the model scores as high ROI
    this.resolutions = []; // markets resolved while tracked
    this.seriesMeta = new Map(); // series ticker -> { category, tags, scope, title }
    this.status = {
      dataMode: 'starting',
      lastPollAt: null,
      lastPollMs: null,
      lastError: null,
      consecutiveErrors: 0,
      pollCount: 0,
      exchangeActive: null,
      tracked: 0,
      notes: [],
    };
    this.rateLimit = null;
    this.#loadSeriesCache();
    this.#loadResolutions();
  }

  // ---- persistence helpers -------------------------------------------------

  #seriesCachePath() {
    return path.join(this.dataDir, 'series-categories.json');
  }

  #loadSeriesCache() {
    try {
      const raw = fs.readFileSync(this.#seriesCachePath(), 'utf8');
      const parsed = JSON.parse(raw);
      const age = Date.now() - new Date(parsed.cachedAt ?? 0).getTime();
      if (age > 1000 * 60 * 60 * 12) return; // stale after 12h
      for (const [k, v] of Object.entries(parsed.map ?? {})) this.seriesMeta.set(k, v);
      this.logger.info?.(`series metadata cache: ${this.seriesMeta.size} series`);
    } catch {
      /* no cache yet */
    }
  }

  #saveSeriesCache() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(
        this.#seriesCachePath(),
        JSON.stringify({ cachedAt: new Date().toISOString(), map: Object.fromEntries(this.seriesMeta) }, null, 0),
      );
    } catch (err) {
      this.logger.warn?.(`could not persist series cache: ${err.message}`);
    }
  }

  #resolutionsPath() {
    return path.join(this.dataDir, 'resolutions.json');
  }

  #loadResolutions() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#resolutionsPath(), 'utf8'));
      if (Array.isArray(parsed.resolutions)) this.resolutions = parsed.resolutions;
    } catch {
      /* none yet */
    }
  }

  #saveResolutions() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.#resolutionsPath(), JSON.stringify({ resolutions: this.resolutions.slice(0, 2000) }, null, 2));
    } catch (err) {
      this.logger.warn?.(`could not persist resolutions: ${err.message}`);
    }
  }

  // ---- series categories ---------------------------------------------------

  /**
   * Build series -> official metadata map from GET /series?category=...
   * Stores exactly what the API returns: category, tags and product_metadata.scope.
   */
  async refreshSeriesCategories({ force = false } = {}) {
    if (!force && this.seriesMeta.size > 200) return;
    let added = 0;
    for (const category of SERIES_CATEGORIES) {
      try {
        const data = await this.client.seriesList({ category });
        for (const s of data?.series ?? []) {
          if (!s?.ticker) continue;
          this.seriesMeta.set(s.ticker, seriesMeta(s));
          added += 1;
        }
      } catch (err) {
        this.logger.warn?.(`series list for ${category} failed: ${err.message}`);
      }
    }
    if (added) this.#saveSeriesCache();
    this.logger.info?.(`series metadata refreshed (+${added}, total ${this.seriesMeta.size})`);
  }

  // ---- polling -------------------------------------------------------------

  async pollOnce() {
    if (this.requestedMode === 'demo') return this.#pollSynthetic();
    if (this.requestedMode === 'snapshot') return this.#pollSnapshot();
    const started = Date.now();
    this.status.pollCount += 1;
    try {
      const exchange = await this.client.exchangeStatus();
      this.status.exchangeActive = Boolean(exchange?.exchange_active);
      this.status.tradingActive = Boolean(exchange?.trading_active);
      this.rateLimit = this.client.lastRateLimit;

      if (!this.status.exchangeActive) {
        this.status.notes = ['Kalshi demo reports exchange_active = false; prices will not move.'];
      }

      const openMarkets = await this.client.allMarkets(
        { status: 'open', limit: 1000 },
        { maxPages: this.maxMarketPages },
      );
      const candidates = this.#classify(openMarkets);
      const tracked = this.#selectTracked(candidates);
      await this.#refreshBooks(tracked);

      this.status.dataMode = 'live';
      this.effectiveMode = 'live';
      this.status.lastError = null;
      this.status.consecutiveErrors = 0;
      this.status.notes = this.status.notes.filter((n) => !n.startsWith('Kalshi demo reports'));
      if (!this.status.exchangeActive) {
        this.status.notes.push('Kalshi demo reports exchange_active = false; prices will not move.');
      }
    } catch (err) {
      this.status.consecutiveErrors += 1;
      this.status.lastError = err.message;
      this.status.notes = [`Last poll failed: ${err.message}`];
      this.logger.error?.(`poll failed (${this.status.consecutiveErrors}): ${err.message}`);
      // After two consecutive failures the UI must not keep claiming "live".
      if (this.status.consecutiveErrors >= 2 && this.status.dataMode === 'live') {
        this.status.dataMode = 'stale';
      }
      // Optional fallback so a demo of the UI is still possible on a blocked network.
      if (this.allowDemoFallback && this.status.consecutiveErrors >= 2) {
        this.logger.warn?.('live API unreachable; switching to synthetic demo mode (clearly labelled in the UI)');
        this.effectiveMode = 'demo';
        this.status.notes = [DEMO_MODE_NOTICE];
        this.emit('update', { reason: 'fallback_demo' });
        return;
      }
      this.emit('update', { reason: 'poll_error', error: err.message });
      throw err;
    } finally {
      this.status.lastPollAt = new Date().toISOString();
      this.status.lastPollMs = Date.now() - started;
      this.status.tracked = this.markets.size;
    }
    this.emit('update', { reason: 'poll' });
  }

  /** Poll using committed real values (labelled snapshot). */
  async #pollSnapshot() {
    if (!this.snapshot) {
      const file = path.join(this.dataDir, 'snapshot.json');
      this.snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [ticker, meta] of Object.entries(this.snapshot.series ?? {})) {
        this.seriesMeta.set(ticker, meta);
      }
    }
    this.status.pollCount += 1;
    const started = Date.now();
    const candidates = this.#classify(this.snapshot.markets ?? []);
    const tracked = this.#selectTracked(candidates);
    const ts = Date.now();
    for (const { market, seriesTicker, meta, topicId, reason } of tracked) {
      // Real bid/ask from the capture; derive a mid from them, never invent one.
      const yesBid = numeric(market.yes_bid_dollars);
      const noBid = numeric(market.no_bid_dollars);
      const yesAsk = noBid !== null ? round4(1 - noBid) : numeric(market.yes_ask_dollars);
      const price =
        yesBid !== null && yesAsk !== null ? round4((yesBid + yesAsk) / 2) : numeric(market.last_price_dollars);
      if (price === null) continue;
      this.#ingest(market, { seriesTicker, meta, topicId, reason, ts, price, top: { yesBid, yesAsk }, book: null, liq: { contracts: null, notionalDollars: null } });
    }
    this.status.dataMode = 'snapshot';
    this.effectiveMode = 'snapshot';
    this.status.notes = [`Snapshot of real demo values captured ${this.snapshot.capturedAt}. Not live.`];
    this.status.lastPollAt = new Date().toISOString();
    this.status.lastPollMs = Date.now() - started;
    this.status.tracked = this.markets.size;
    this.emit('update', { reason: 'poll_snapshot' });
  }

  /** Poll using locally generated synthetic markets (labelled demo). */
  async #pollSynthetic() {
    this.status.pollCount += 1;
    const started = Date.now();
    for (const [ticker, meta] of Object.entries(SYNTHETIC_SERIES)) this.seriesMeta.set(ticker, meta);
    const markets = syntheticMarkets();
    const candidates = this.#classify(markets);
    const tracked = this.#selectTracked(candidates);
    const ts = Date.now();
    for (const { market, seriesTicker, meta, topicId, reason } of tracked) {
      const book = syntheticBook(market);
      const top = topOfBook(book);
      const liq = liquidity(book);
      const price = midPrice(book, market.last_price_dollars);
      this.#ingest(market, { seriesTicker, meta, topicId, reason, ts, price, top, book, liq });
    }
    this.status.dataMode = 'demo';
    this.effectiveMode = 'demo';
    this.status.notes = [DEMO_MODE_NOTICE];
    this.status.lastPollAt = new Date().toISOString();
    this.status.lastPollMs = Date.now() - started;
    this.status.tracked = this.markets.size;
    this.emit('update', { reason: 'poll_demo' });
  }

  /**
   * Shared ingestion for one market: store history, run the swing detector, alert.
   * All three data modes call this, so behaviour cannot drift between them.
   */
  #ingest(market, { seriesTicker, meta, topicId, reason, ts, price, top, book, liq }) {
    const existing = this.markets.get(market.ticker) ?? { ticker: market.ticker, history: [], firstSeenAt: ts };
    const next = {
      ...existing,
      ticker: market.ticker,
      title: market.title,
      yesSubTitle: market.yes_sub_title ?? null,
      eventTicker: market.event_ticker,
      seriesTicker,
      kalshiCategory: meta?.category ?? null,
      kalshiTags: meta?.tags ?? [],
      kalshiScope: meta?.scope ?? null,
      seriesTitle: meta?.title ?? null,
      topicId,
      topicReason: reason,
      status: market.status ?? null,
      result: market.result ?? '',
      closeTime: market.close_time ?? null,
      expectedExpiration: market.expected_expiration_time ?? null,
      volume: numeric(market.volume_fp),
      volume24h: numeric(market.volume_24h_fp),
      openInterest: numeric(market.open_interest_fp),
      lastPrice: numeric(market.last_price_dollars),
      previousPrice: numeric(market.previous_price_dollars),
      yesBid: top?.yesBid ?? numeric(market.yes_bid_dollars),
      yesAsk: top?.yesAsk ?? numeric(market.yes_ask_dollars),
      yesBidSize: top?.yesBidSize ?? numeric(market.yes_bid_size_fp),
      yesAskSize: top?.yesAskSize ?? numeric(market.yes_ask_size_fp),
      spread: spreadOf(top ?? {}),
      liquidityContracts: liq?.contracts ?? null,
      liquidityDollars: liq?.notionalDollars ?? null,
      book: book ? { yes: tail(book.yes, 10), no: tail(book.no, 10) } : null,
      price,
      priceUpdatedAt: new Date(ts).toISOString(),
      dataMode: this.effectiveMode,
      kalshiUrl: market.ticker.startsWith('DEMO-') ? null : kalshiMarketUrl(market.ticker, this.env),
    };
    next.history = appendHistory(existing.history, { t: ts, p: price });
    this.markets.set(market.ticker, next);

    const alerts = this.detector.observe(market, {
      price,
      ts,
      source: `${this.effectiveMode}_poll`,
      topicId,
      reason,
      seriesTicker,
      liquidity: { contracts: liq?.contracts ?? null, dollars: liq?.notionalDollars ?? null },
      kalshiUrl: next.kalshiUrl,
    });
    for (const alert of alerts) this.#handleAlert(alert, next);
  }

  /** Classify every market into one of the five topics (or drop it). */
  #classify(markets) {
    const out = [];
    for (const m of markets) {
      const seriesTicker = seriesTickerOf(m);
      const meta = this.seriesMeta.get(seriesTicker) ?? {};
      const match = classifyMarket(m, { seriesTicker, ...meta });
      if (!match) continue;
      out.push({ market: m, seriesTicker, meta, ...match });
    }
    return out;
  }

  /** Pick the busiest markets per topic so orderbook polling stays inside rate limits. */
  #selectTracked(candidates) {
    const byTopic = new Map(TOPICS.map((t) => [t.id, []]));
    for (const c of candidates) {
      // Skip multivariate combos: they are synthetic basket tickets, not single events.
      if (c.market.mve_collection_ticker) continue;
      byTopic.get(c.topicId)?.push(c);
    }
    const score = (c) => {
      const vol = Number(c.market.volume_24h_fp ?? c.market.volume_fp ?? 0);
      const oi = Number(c.market.open_interest_fp ?? 0);
      return vol * 2 + oi;
    };
    const picked = [];
    for (const [, list] of byTopic) {
      list.sort((a, b) => score(b) - score(a));
      picked.push(...list.slice(0, this.trackedPerTopic));
    }
    // Also always track markets that already have an open paper position.
    const held = new Set(this.paper.openPositions().map((p) => p.ticker));
    for (const c of candidates) {
      if (held.has(c.market.ticker) && !picked.includes(c)) picked.push(c);
    }
    return picked;
  }

  async #refreshBooks(tracked) {
    const queue = [...tracked];
    const results = [];
    const workers = Array.from({ length: Math.max(1, this.orderbookConcurrency) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        try {
          const book = await this.client.orderbook(item.market.ticker);
          results.push({ item, book });
        } catch (err) {
          results.push({ item, book: null, error: err.message });
        }
      }
    });
    await Promise.all(workers);
    const ts = Date.now();

    for (const { item, book } of results) {
      const { market, seriesTicker, meta, topicId, reason } = item;
      const liq = book ? liquidity(book) : { contracts: null, notionalDollars: null };
      const top = book ? topOfBook(book) : {};
      // Price basis, in order of preference, all from documented fields:
      //   1. orderbook mid (derived from bids per the official Orderbook Responses page)
      //   2. GET /markets `last_price_dollars` ("Price for the last traded YES contract")
      const price = book ? midPrice(book, market.last_price_dollars) : numeric(market.last_price_dollars);
      if (price === null) continue;

      const existing = this.markets.get(market.ticker) ?? {
        ticker: market.ticker,
        history: [],
        firstSeenAt: ts,
      };
      const next = {
        ...existing,
        ticker: market.ticker,
        title: market.title,
        yesSubTitle: market.yes_sub_title ?? null,
        eventTicker: market.event_ticker,
        seriesTicker,
        kalshiCategory: meta?.category ?? null,
        kalshiTags: meta?.tags ?? [],
        kalshiScope: meta?.scope ?? null,
        seriesTitle: meta?.title ?? null,
        topicId,
        topicReason: reason,
        status: market.status ?? null,
        result: market.result ?? '',
        closeTime: market.close_time ?? null,
        expectedExpiration: market.expected_expiration_time ?? null,
        volume: numeric(market.volume_fp),
        volume24h: numeric(market.volume_24h_fp),
        openInterest: numeric(market.open_interest_fp),
        lastPrice: numeric(market.last_price_dollars),
        previousPrice: numeric(market.previous_price_dollars),
        previousYesBid: numeric(market.previous_yes_bid_dollars),
        previousYesAsk: numeric(market.previous_yes_ask_dollars),
        yesBid: top.yesBid ?? numeric(market.yes_bid_dollars),
        yesAsk: top.yesAsk ?? numeric(market.yes_ask_dollars),
        yesBidSize: top.yesBidSize ?? numeric(market.yes_bid_size_fp),
        yesAskSize: top.yesAskSize ?? numeric(market.yes_ask_size_fp),
        spread: spreadOf(top),
        liquidityContracts: liq.contracts,
        liquidityDollars: liq.notionalDollars,
        book: book ? { yes: tail(book.yes, 10), no: tail(book.no, 10) } : null,
        price,
        priceUpdatedAt: new Date(ts).toISOString(),
        kalshiUrl: kalshiMarketUrl(market.ticker, this.env),
      };
      next.history = appendHistory(existing.history, { t: ts, p: price });
      this.markets.set(market.ticker, next);

      // ---- swing detection ----
      const alerts = this.detector.observe(market, {
        price,
        ts,
        source: 'rest_orderbook',
        topicId,
        reason,
        seriesTicker,
        liquidity: {
          contracts: liq.contracts,
          dollars: liq.notionalDollars,
          yesBidSize: top.yesBidSize ?? null,
          yesAskSize: top.yesAskSize ?? null,
        },
        kalshiUrl: next.kalshiUrl,
      });
      for (const alert of alerts) this.#handleAlert(alert, next);
    }
  }

  #handleAlert(alert, market) {
    const score = roiScore({
      fromPrice: alert.fromPrice,
      toPrice: alert.toPrice,
      spread: market.spread,
      liquidityDollars: market.liquidityDollars ?? 0,
      openInterest: market.openInterest ?? 0,
      volume24h: market.volume24h ?? 0,
      timeToCloseHours: hoursUntil(market.closeTime),
    });
    const enriched = {
      ...alert,
      title: market.title,
      topicId: market.topicId,
      score: score.score,
      roiFactors: score.factors,
      spread: market.spread,
      yesBid: market.yesBid,
      yesAsk: market.yesAsk,
      volume24h: market.volume24h,
      openInterest: market.openInterest,
      kalshiUrl: market.kalshiUrl,
    };

    this.alerts.unshift(enriched);
    if (this.alerts.length > 600) this.alerts.length = 600;

    if (enriched.score >= HIGH_ROI_MIN_SCORE) {
      this.modelAlerts.unshift(enriched);
      if (this.modelAlerts.length > 300) this.modelAlerts.length = 300;
      this.#maybeTrade(enriched, market);
    }

    // Shadow tournament: the same swing, for every strategy, at the same quote.
    this.tournament.onSwing({
      swing: {
        ticker: alert.ticker,
        title: market.title,
        topicId: market.topicId,
        from: alert.fromPrice,
        to: alert.toPrice,
        delta: alert.toPrice - alert.fromPrice,
        at: alert.at ?? Date.now(),
      },
      quote: { yesBidDollars: market.yesBid, yesAskDollars: market.yesAsk },
    });

    this.emit('alert', enriched);
  }

  #maybeTrade(alert, market) {
    if (!this.enablePaperTrading) return;
    const alreadyOpen = this.paper.openPositions().some((p) => p.ticker === alert.ticker);
    if (alreadyOpen) return; // one paper position per market keeps experiments clean
    const decision = decideTrade(alert, {
      bankrollCents: this.paper.state.cashCents,
      strategies: this.strategies,
    });
    if (!decision) return;
    const res = this.paper.open({
      ticker: alert.ticker,
      eventTicker: alert.eventTicker,
      title: alert.title,
      topicId: alert.topicId,
      strategy: decision.strategy,
      outcome: decision.outcome,
      price: decision.entryPrice,
      contracts: decision.contracts,
      alertId: alert.id,
      meta: {
        swingDirection: alert.direction,
        swingFrom: alert.fromPrice,
        swingTo: alert.toPrice,
        score: alert.score,
        basis: alert.basis,
      },
    });
    if (res.ok) {
      this.logger.info?.(
        `paper OPEN ${decision.strategy} ${decision.outcome.toUpperCase()} ${decision.contracts}x ${alert.ticker} @ ${decision.entryPrice}`,
      );
      this.emit('trade', { type: 'open', position: res.position });
    }
  }

  /** Mark open paper positions to market and apply each strategy's exit rule. */
  managePositions() {
    const closed = [];
    for (const pos of [...this.paper.openPositions()]) {
      const m = this.markets.get(pos.ticker);
      if (!m) continue;

      if (m.status === 'settled' || m.status === 'finalized' || m.result === 'yes' || m.result === 'no') {
        if (m.result === 'yes' || m.result === 'no') {
          closed.push(...this.paper.settleMarket(pos.ticker, m.result));
          this.#recordResolution(m, m.result);
        }
        continue;
      }

      const exitPrice = pos.outcome === 'yes' ? m.price : 1 - m.price;
      const pnlPerContract = exitPrice - pos.entryPrice;
      const rule = exitRule(pos.strategy);
      if (pnlPerContract >= rule.takeProfit) {
        const r = this.paper.close(pos.id, { price: exitPrice, reason: 'take_profit' });
        if (r.ok) closed.push(r.trade);
      } else if (pnlPerContract <= -rule.stopLoss) {
        const r = this.paper.close(pos.id, { price: exitPrice, reason: 'stop_loss' });
        if (r.ok) closed.push(r.trade);
      } else if (m.closeTime && Date.now() > new Date(m.closeTime).getTime()) {
        const r = this.paper.close(pos.id, { price: exitPrice, reason: 'market_closed' });
        if (r.ok) closed.push(r.trade);
      }
    }
    for (const t of closed) {
      this.logger.info?.(`paper CLOSE ${t.strategy} ${t.ticker} pnl ${(t.pnlCents / 100).toFixed(2)} (${t.closeReason})`);
      this.emit('trade', { type: 'close', trade: t });
    }
    return closed;
  }

  /** Record a market resolution once, with the official result Kalshi reports. */
  #recordResolution(market, result) {
    if (this.resolutions.some((r) => r.ticker === market.ticker)) return;
    // Settle the shadow books against the exchange's own result field. This is the
    // same signal the paper broker uses; nothing is settled on an estimate.
    const shadow = this.tournament.settle({ ticker: market.ticker, result });
    if (shadow.length) {
      this.logger.info?.(`tournament settled ${shadow.length} shadow positions for ${market.ticker} (result ${result})`);
    }
    this.resolutions.unshift({
      ticker: market.ticker,
      title: market.title,
      topicId: market.topicId,
      eventTicker: market.eventTicker,
      result,
      lastPrice: market.lastPrice,
      closeTime: market.closeTime,
      recordedAt: new Date().toISOString(),
      resultSource: 'GET /markets -> result field',
      kalshiUrl: market.kalshiUrl,
    });
    if (this.resolutions.length > 2000) this.resolutions.length = 2000;
    this.#saveResolutions();
  }

  /** Ask the API directly for recently settled markets in our tracked topics. */
  async refreshResolutions() {
    try {
      const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 3;
      const settled = await this.client.allMarkets({ status: 'settled', minSettledTs: since, limit: 1000 }, { maxPages: 3 });
      let added = 0;
      for (const m of settled) {
        if (m.result !== 'yes' && m.result !== 'no') continue;
        const seriesTicker = seriesTickerOf(m);
        const match = classifyMarket(m, { seriesTicker, ...(this.seriesMeta.get(seriesTicker) ?? {}) });
        if (!match) continue;
        if (this.resolutions.some((r) => r.ticker === m.ticker)) continue;
        this.tournament.settle({ ticker: m.ticker, result: m.result });
        this.resolutions.unshift({
          ticker: m.ticker,
          title: m.title,
          topicId: match.topicId,
          eventTicker: m.event_ticker,
          result: m.result,
          lastPrice: numeric(m.last_price_dollars),
          closeTime: m.close_time ?? null,
          settlementValue: numeric(m.settlement_value_dollars),
          recordedAt: new Date().toISOString(),
          resultSource: 'GET /markets?status=settled -> result field',
          kalshiUrl: kalshiMarketUrl(m.ticker, this.env),
        });
        added += 1;
      }
      if (added) {
        this.resolutions.sort((a, b) => new Date(b.closeTime ?? 0) - new Date(a.closeTime ?? 0));
        this.resolutions = this.resolutions.slice(0, 2000);
        this.#saveResolutions();
      }
      return added;
    } catch (err) {
      this.logger.warn?.(`resolution refresh failed: ${err.message}`);
      return 0;
    }
  }

  // ---- views ---------------------------------------------------------------

  topicView() {
    return TOPICS.map((t) => {
      const markets = [...this.markets.values()].filter((m) => m.topicId === t.id);
      return {
        ...t,
        marketCount: markets.length,
        alerts: this.alerts.filter((a) => a.topicId === t.id).length,
        totalVolume24h: markets.reduce((s, m) => s + (m.volume24h ?? 0), 0),
        markets: markets
          .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
          .map(publicMarket),
      };
    });
  }

  state() {
    const topics = this.topicView();
    const closedTrades = this.paper.closedTrades();
    const analysis = analyzeTrades(closedTrades);
    const open = this.paper.openPositions().map((p) => {
      const m = this.markets.get(p.ticker);
      const current = m?.price ?? null;
      const mark = current === null ? null : this.paper.markPrice(p, current);
      return {
        ...p,
        currentPrice: current,
        markValueCents: mark,
        unrealizedCents: mark === null ? null : mark - p.costCents,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      dataMode: this.status.dataMode,
      status: this.status,
      environment: {
        id: this.env,
        rest: this.client.base,
        ws: this.client.wsUrl,
        docs: this.env === 'demo'
          ? 'https://docs.kalshi.com/getting_started/demo_env'
          : 'https://docs.kalshi.com/getting_started/api_environments',
      },
      rateLimit: this.rateLimit,
      threshold: SWING_THRESHOLD_DOLLARS,
      highRoiMinScore: HIGH_ROI_MIN_SCORE,
      topics,
      alerts: this.alerts.slice(0, 200),
      modelAlerts: this.modelAlerts.slice(0, 120),
      alertCounts: { total: this.alerts.length, model: this.modelAlerts.length },
      resolutions: this.resolutions.slice(0, 120),
      portfolio: {
        simulated: this.paper.summary,
        openPositions: open,
        closedTrades: closedTrades.slice(-100).reverse(),
        analysis,
        // Four strategies on the same swing stream; see server/tournament.js.
        tournament: this.tournament.report(),
        tournamentTrades: this.tournament.trades(120),
        kalshiDemoAccount: null,
        strategies: Object.entries(STRATEGY_META).map(([id, meta]) => ({ id, ...meta })),
      },
    };
  }
}

// ---- helpers ---------------------------------------------------------------

function seriesTickerOf(market) {
  const et = market.event_ticker ?? '';
  const idx = et.indexOf('-');
  return idx > 0 ? et.slice(0, idx) : et;
}

function numeric(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? round4(n) : null;
}

function spreadOf(top) {
  if (top.yesBid === null || top.yesBid === undefined) return null;
  if (top.yesAsk === null || top.yesAsk === undefined) return null;
  return round4(top.yesAsk - top.yesBid);
}

function tail(arr, n) {
  return arr.slice(Math.max(0, arr.length - n));
}

function appendHistory(history, point) {
  const next = history ?? [];
  const last = next[next.length - 1];
  if (last && last.t === point.t) next[next.length - 1] = point;
  else next.push(point);
  if (next.length > 4000) next.splice(0, next.length - 4000);
  return next;
}

function hoursUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? ms / 3600000 : null;
}

function exitRule(strategy) {
  switch (strategy) {
    case STRATEGIES.MOMENTUM:
      return { takeProfit: 0.15, stopLoss: 0.08 };
    case STRATEGIES.MEAN_REVERT:
      return { takeProfit: 0.1, stopLoss: 0.12 };
    case STRATEGIES.THRESHOLD_BREAK:
      return { takeProfit: 0.2, stopLoss: 0.1 };
    case STRATEGIES.FADE_EXTREME:
      return { takeProfit: 0.1, stopLoss: 0.15 };
    default:
      return { takeProfit: 0.15, stopLoss: 0.1 };
  }
}

/** Public shape of a market for the API/UI (history excluded). */
export function publicMarket(m) {
  const { history, ...rest } = m;
  return { ...rest, historyPoints: history?.length ?? 0 };
}

export { moveDollars };

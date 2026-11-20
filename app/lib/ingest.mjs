// The live pipeline: discovery -> observation -> alert -> score -> paper trade ->
// resolution. This is the module that ties every other module together, and the
// only place where incoming Kalshi-shaped data is interpreted.
//
// Data flow (each arrow is a verified contract):
//   REST /series + /events + /markets   discover markets in the 5 topics   K11 K12 K9
//   REST /markets/{t}/orderbook         depth + implied asks               K5  K10
//   WS ticker / trade                   price stream                       K18 K19
//   WS market_lifecycle_v2              determined / settled => YES or NO  K21
//   AlertEngine.observe                 >= $0.10 move => alert
//   scoreAlert                          promote to the model chat or not
//   PaperBroker                         simulated entries/exits per strategy
//   Resolution log                      terminal YES/NO per event           K21

import { EventEmitter } from 'node:events';
import { MarketIndex } from './state.mjs';
import { AlertEngine, makeAlertEngine } from './alerts.mjs';
import { PaperBroker } from './paper.mjs';
import { scoreAlert, depthSummary, decideEntries, STRATEGIES } from './strategy.mjs';
import { classifier } from './topics.mjs';
import { analyze, rankStrategies, reconcile } from './portfolio.mjs';
import { KalshiRest } from './rest.mjs';
import { KalshiWs } from './kalshiWs.mjs';
import { Broker } from './broker.mjs';
import { config, hasCredentials, dataSourceMode } from '../config.mjs';
import { dollarsToTicks, countToCents100, nextId, fmtPrice } from './util.mjs';
import { loadPrivateKeyFromEnv } from './signing.mjs';
import { KxMockFeed } from '../mock/feed.mjs';

const T = 1_000_000;

export class IngestEngine extends EventEmitter {
  constructor({ cfg = config, rest = null, logger = console } = {}) {
    super();
    this.cfg = cfg;
    this.logger = logger;
    this.index = new MarketIndex();
    this.alerts = makeAlertEngine(cfg);
    this.paper = new PaperBroker({ startTicks: cfg.model.paperStartTicks, logger });
    this.rest = rest;
    this.broker = new Broker({ rest: rest ?? null, logger, dataDir: cfg.dataDir });
    this.ws = null;
    this.mock = null;
    this.mode = 'starting';
    this.modeReason = '';
    this.resolutions = [];
    this.eventMeta = new Map(); // eventTicker -> {title, seriesTicker, topic, settlementSources, closeSec}
    this.causesConfig = cfg.topics;
    this.timers = [];
    this.startedAt = null;
    this.lastDiscoverAt = 0;
    this.discovery = { series: [], events: 0, markets: 0, topics: {}, unclassified: 0, errors: [] };
    this.live = {
      connected: false,
      balanceTicks: null,
      portfolioValueTicks: null,
      positions: [],
      lastBalanceAt: null,
      error: null
    };
    this.statusHistory = [];
  }

  /* ------------------------------------------------------------- lifecycle */
  async start() {
    this.startedAt = Date.now();
    const mode = dataSourceMode();

    if (mode === 'mock') {
      this.startMock();
      return;
    }

    // 'live' or 'auto': try Kalshi. In auto mode a failure falls back to the mock
    // feed so the dashboard still runs, and says loudly that it is simulated.
    const ok = await this.tryLive();
    if (!ok && mode === 'auto') {
      this.modeReason = `Kalshi unreachable from this environment (${this.modeReason}); running the labelled local simulator instead.`;
      this.startMock();
    }
  }

  async tryLive() {
    let keyPair = null;
    try {
      keyPair = loadPrivateKeyFromEnv();
    } catch (err) {
      this.logger.warn?.(`[ingest] private key could not be loaded: ${err.message}`);
    }
    this.rest = new KalshiRest({ keyId: cfgKeyId(this.cfg), keyPair, logger: this.logger });
    this.broker = new Broker({ rest: this.rest, logger: this.logger, dataDir: this.cfg.dataDir });

    try {
      const st = await this.rest.exchangeStatus();
      this.exchangeStatus = st;
    } catch (err) {
      this.mode = 'offline';
      this.modeReason = err.message;
      this.logger.warn?.(`[ingest] exchange/status failed: ${err.message}`);
      return false;
    }

    await this.discover();
    if (!this.index.markets.size) {
      this.mode = 'offline';
      this.modeReason = 'discovery returned no markets in the five topics';
      return false;
    }

    this.startLiveWs(keyPair);
    this.startPoller();
    this.mode = 'live';
    this.modeReason = `Kalshi demo live (${this.cfg.restBase})`;
    this.emit('mode', { mode: this.mode, reason: this.modeReason });
    return true;
  }

  startMock() {
    this.mode = 'mock';
    this.exchangeStatus = { exchange_active: true, trading_active: true, _synthetic: true };
    this.mock = new KxMockFeed({ seed: 11, intervalMs: Number(process.env.MOCK_INTERVAL_MS || 700) });
    this.mock.on('messages', (msgs) => {
      for (const m of msgs) this.handleWsMessage(m);
    });
    this.mock.on('ready', async () => {
      // Seed the index from the mock's REST-shaped market list so discovery and the
      // live path share one code path.
      this.subscribeTickers = this.mock.markets().map((m) => m.ticker);
      await this.discover();
      this.emit('mode', { mode: this.mode, reason: this.modeReason || 'local simulator (labelled)' });
    });
    this.mock.start();
    this.startPoller();
  }

  startLiveWs(keyPair) {
    this.ws = new KalshiWs({
      url: this.cfg.wsBase,
      keyPair,
      keyId: cfgKeyId(this.cfg),
      logger: this.logger,
      onMessage: (m) => this.handleWsMessage(m),
      onStatus: (s) => {
        this.wsStatus = s;
        this.emit('ws', s);
      }
    });
    // K18: the market filter must be set before the first subscribe.
    if (this.subscribeTickers?.length) this.ws.setMarketFilter(this.subscribeTickers);
    this.ws.connect();
  }

  startPoller() {
    const poll = async (fn, ms, name) => {
      const run = async () => {
        try {
          await fn();
        } catch (err) {
          this.logger.warn?.(`[poll ${name}] ${err.message}`);
        }
      };
      this.timers.push(setInterval(run, ms));
      await run();
    };

    if (this.mode === 'live') {
      this.timers.push(setInterval(() => this.discover().catch((e) => this.logger.warn?.(`[discover] ${e.message}`)), this.cfg.poll.eventsMs));
      this.timers.push(setInterval(() => this.pollOrderbooks().catch((e) => this.logger.warn?.(`[book] ${e.message}`)), this.cfg.poll.orderbookMs));
      if (hasCredentials()) {
        this.timers.push(setInterval(() => this.refreshLiveAccount().catch((e) => this.logger.warn?.(`[account] ${e.message}`)), this.cfg.poll.balanceMs));
      }
    } else {
      // Mock mode still needs orderbooks so scoring/sizing has depth to work with.
      this.timers.push(setInterval(() => this.pollOrderbooks().catch(() => {}), 4_000));
    }
    void poll;
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.ws?.close();
    this.mock?.stop();
  }

  /* ------------------------------------------------------------- discovery */
  async discover() {
    if (this.mode === 'mock' || !this.rest) {
      if (this.mode !== 'mock') return;
      const list = this.mock.markets();
      for (const mk of list) this.ingestMarket(mk);
      this.discovery.events = this.mock.events().length;
      this.discovery.markets = list.length;
      return;
    }
    this.lastDiscoverAt = Date.now();
    const errors = [];
    const topicCounts = {};

    // 1. Series for each topic category, so we learn which series exist (K12).
    const seriesSeen = new Map();
    try {
      const res = await this.rest.seriesList({ includeVolume: true });
      for (const s of res?.series ?? []) {
        const cls = classifier.classify({
          seriesTicker: s.ticker,
          eventTitle: s.title,
          categories: s.categories || [s.category].filter(Boolean),
          tags: s.tags || []
        });
        if (cls) {
          seriesSeen.set(s.ticker, { ...s, topic: cls.id, topicReason: cls.reason });
          topicCounts[cls.id] = (topicCounts[cls.id] || 0) + 1;
        }
      }
    } catch (err) {
      errors.push({ step: 'series', message: err.message, code: err.code });
    }

    // 2. Open events with nested markets (K11). One pass, then classify.
    let events = [];
    try {
      const res = await this.rest.events({ status: 'open', limit: 200, withNestedMarkets: true });
      events = res?.events ?? [];
      // paginate conservatively (up to 3 pages) so one page cannot starve a topic
      let cursor = res?.cursor;
      let page = 0;
      while (cursor && page < 2) {
        const next = await this.rest.events({ status: 'open', limit: 200, withNestedMarkets: true, cursor });
        events = events.concat(next?.events ?? []);
        cursor = next?.cursor;
        page += 1;
      }
    } catch (err) {
      errors.push({ step: 'events', message: err.message, code: err.code });
    }

    let markets = 0;
    let unclassified = 0;
    for (const ev of events) {
      const seriesTicker = ev.series_ticker || (ev.markets?.[0]?.series_ticker ?? '');
      const seriesInfo = seriesSeen.get(seriesTicker) || null;
      const cls =
        classifier.classify({
          seriesTicker,
          eventTitle: ev.title,
          categories: seriesInfo?.categories || [],
          tags: seriesInfo?.tags || []
        }) || (seriesInfo ? { id: seriesInfo.topic, reason: seriesInfo.topicReason, confidence: 'medium' } : null);
      if (!cls) {
        unclassified += 1;
        continue;
      }
      this.eventMeta.set(ev.event_ticker, {
        title: ev.title,
        subTitle: ev.sub_title,
        seriesTicker,
        topic: cls.id,
        topicReason: cls.reason,
        settlementSources: ev.settlement_sources || seriesInfo?.settlement_sources || [],
        mutuallyExclusive: Boolean(ev.mutually_exclusive),
        closeSec: null
      });
      for (const mk of ev.markets ?? []) {
        this.ingestMarket({
          ticker: mk.ticker,
          eventTicker: ev.event_ticker,
          eventTitle: ev.title,
          seriesTicker,
          title: mk.title || ev.title,
          subtitle: mk.subtitle || mk.yes_sub_title || '',
          status: mk.status,
          closeSec: Math.floor(new Date(mk.close_time || 0).getTime() / 1000) || null,
          openSec: Math.floor(new Date(mk.open_time || 0).getTime() / 1000) || null,
          yesBidTicks: dollarsToTicks(mk.yes_bid_dollars),
          yesAskTicks: dollarsToTicks(mk.yes_ask_dollars),
          lastTicks: dollarsToTicks(mk.last_price_dollars),
          volumeContracts: countToCents100(mk.volume_fp) ? countToCents100(mk.volume_fp) / 100 : null,
          volume24hContracts: countToCents100(mk.volume_24h_fp) ? countToCents100(mk.volume_24h_fp) / 100 : null,
          openInterestContracts: countToCents100(mk.open_interest_fp) ? countToCents100(mk.open_interest_fp) / 100 : null,
          liquidityTicks: dollarsToTicks(mk.liquidity_dollars),
          result: mk.result || '',
          settlementValueTicks: dollarsToTicks(mk.settlement_value_dollars),
          settlementTs: mk.settlement_ts ? Math.floor(new Date(mk.settlement_ts).getTime() / 1000) : null,
          rulesPrimary: mk.rules_primary || '',
          topic: cls.id,
          topicReason: cls.reason,
          topicConfidence: cls.confidence
        });
        markets += 1;
      }
    }

    this.discovery = {
      series: [...seriesSeen.keys()],
      events: events.length,
      markets,
      topics: topicCounts,
      unclassified,
      errors,
      at: this.lastDiscoverAt,
      synthetic: false
    };

    // Restrict the WS to what we track (K8/K18: filter must be set before subscribe).
    const tickers = [...this.index.markets.keys()].slice(0, this.cfg.poll.maxMarkets);
    this.subscribeTickers = tickers;
    this.ws?.setMarketFilter(tickers);
    this.emit('discovery', this.discovery);
  }

  /** Normalize one market-shaped object into the index, classifying it if needed. */
  ingestMarket(mk) {
    const cls =
      mk.topic
        ? { id: mk.topic, reason: mk.topicReason, confidence: mk.topicConfidence }
        : classifier.classify({
            seriesTicker: mk.seriesTicker,
            eventTitle: mk.eventTitle,
            marketTitle: mk.title,
            categories: mk.categories || []
          });
    if (!cls) return null;
    const rec = this.index.upsert({ ...mk, topic: cls.id, topicReason: cls.reason, topicConfidence: cls.confidence });
    if (rec && mk.lastTicks) this.index.setPrice(rec.ticker, mk.lastTicks, Date.now());
    return rec;
  }

  /* --------------------------------------------------------------- streams */
  handleWsMessage(m) {
    if (!m || !m.type) return;
    const ts = m.msg?.ts_ms || Date.now();
    switch (m.type) {
      case 'trade': {
        const ticker = m.msg.market_ticker;
        const ticks = dollarsToTicks(m.msg.yes_price_dollars);
        const size = countToCents100(m.msg.count_fp);
        this.onObservation({
          ticker,
          ticks,
          tsMs: ts,
          source: 'trade',
          size: size === null ? null : size / 100,
          priceSource: 'yes'
        });
        break;
      }
      case 'ticker': {
        const ticker = m.msg.market_ticker;
        const ticks = dollarsToTicks(m.msg.price_dollars);
        const rec = this.index.get(ticker);
        if (rec) {
          rec.yesBidTicks = dollarsToTicks(m.msg.yes_bid_dollars) ?? rec.yesBidTicks;
          rec.yesAskTicks = dollarsToTicks(m.msg.yes_ask_dollars) ?? rec.yesAskTicks;
          rec.yesBidSize = countToCents100(m.msg.yes_bid_size_fp) ?? rec.yesBidSize;
          rec.yesAskSize = countToCents100(m.msg.yes_ask_size_fp) ?? rec.yesAskSize;
          rec.volumeContracts = countToCents100(m.msg.volume_fp) !== null ? countToCents100(m.msg.volume_fp) / 100 : rec.volumeContracts;
          rec.openInterestContracts =
            countToCents100(m.msg.open_interest_fp) !== null ? countToCents100(m.msg.open_interest_fp) / 100 : rec.openInterestContracts;
          if (m.msg.dollar_volume !== undefined) rec.dollarVolume = m.msg.dollar_volume;
        }
        this.onObservation({ ticker, ticks, tsMs: ts, source: 'ticker', size: null, priceSource: 'yes' });
        break;
      }
      case 'orderbook_snapshot': {
        const ticker = m.msg.market_ticker;
        this.applyBook(ticker, m.msg, ts);
        break;
      }
      case 'orderbook_delta': {
        // Only used when a key allows the private channel (K20).
        const rec = this.index.get(m.msg.market_ticker);
        if (rec?.book) {
          const side = m.msg.side === 'yes' ? 'yesLevels' : 'noLevels';
          const price = dollarsToTicks(m.msg.price);
          const delta = Number(m.msg.delta);
          const levels = rec.book[side];
          const found = levels.find((l) => l.ticks === price);
          if (found) {
            found.count = Math.max(0, found.count + delta);
            if (found.count === 0) levels.splice(levels.indexOf(found), 1);
          } else if (delta > 0) {
            levels.push({ ticks: price, count: delta });
            levels.sort((a, b) => a.ticks - b.ticks);
          }
          rec.book.ts = ts;
        }
        break;
      }
      case 'market_lifecycle_v2': {
        this.onLifecycle(m.msg, ts);
        break;
      }
      case 'error': {
        this.emit('wsError', m.msg);
        break;
      }
      default:
        break;
    }
  }

  applyBook(ticker, msg, ts) {
    const toLevels = (arr) =>
      (arr || [])
        .map(([p, c]) => ({ ticks: dollarsToTicks(p), count: Number(c) }))
        .filter((l) => Number.isFinite(l.ticks) && Number.isFinite(l.count))
        .sort((a, b) => a.ticks - b.ticks);
    const yesLevels = toLevels(msg.yes_dollars);
    const noLevels = toLevels(msg.no_dollars);
    const rec = this.index.get(ticker);
    if (!rec) return;
    rec.book = { yesLevels, noLevels, ts, source: 'stream' };
    rec.bookSummary = depthSummary(yesLevels, noLevels);
    if (rec.bookSummary.bestYesBid !== null) rec.yesBidTicks = rec.bookSummary.bestYesBid;
    if (rec.bookSummary.bestYesAsk !== null) rec.yesAskTicks = rec.bookSummary.bestYesAsk;
    rec.yesBidSize = yesLevels.length ? yesLevels[yesLevels.length - 1].count : null;
    rec.yesAskSize = noLevels.length ? noLevels[noLevels.length - 1].count : null;
    this.emit('book', { ticker, book: rec.book });
  }

  onObservation(obs) {
    const rec = this.index.get(obs.ticker);
    if (!rec) return;
    if (rec.status && rec.status !== 'open' && rec.status !== 'initialized') return;

    this.index.setPrice(obs.ticker, obs.ticks, obs.tsMs);

    // Mark paper positions to the current bid on their side (exit rules run here).
    const closed = this.paper.mark(obs.ticker, {
      yesBidTicks: rec.yesBidTicks ?? obs.ticks,
      noBidTicks: rec.yesAskTicks !== null ? T - rec.yesAskTicks : null,
      yesTradeTicks: obs.priceSource === 'yes' ? obs.ticks : null,
      atMs: obs.tsMs
    });
    for (const trade of closed) this.emit('paperTrade', trade);

    const alert = this.alerts.observe({
      ticker: obs.ticker,
      ticks: obs.ticks,
      tsMs: obs.tsMs,
      source: obs.source,
      size: obs.size,
      liquidity: rec.bookSummary ? Math.min(rec.bookSummary.yesContracts, rec.bookSummary.noContracts) : null
    });
    if (!alert) return;
    this.onAlert(alert, rec);
  }

  onAlert(alert, rec) {
    alert.eventTicker = rec.eventTicker;
    alert.eventTitle = rec.title;
    alert.marketTitle = rec.subtitle || rec.title;
    alert.topic = rec.topic;
    alert.topicReason = rec.topicReason;
    alert.seriesTicker = rec.seriesTicker;
    alert.closeSec = rec.closeSec;
    alert.chart = rec.points.slice(-120);

    const book = rec.bookSummary || null;
    const siblings = this.siblingSum(rec);
    const score = scoreAlert(alert, {
      market: { closeSec: rec.closeSec, seriesTicker: rec.seriesTicker, mutuallyExclusive: this.eventMeta.get(rec.eventTicker)?.mutuallyExclusive },
      book,
      siblings,
      model: this.cfg.model
    });
    alert.siblings = siblings;
    alert.score = score;
    alert.highRoi = score.promote;
    alert.causes = this.causesFor(rec);

    // Paper tournament: every promoted alert is evaluated by every strategy family
    // so the analytics have comparable rows. Only promoted alerts trade, so the
    // ledger reflects the model's view, not every wiggle.
    if (score.promote) {
      for (const strategyId of Object.keys(STRATEGIES)) {
        const intents = decideEntries(strategyId, { alert, market: rec, book, score, model: this.cfg.model });
        for (const intent of intents) {
          const pos = this.paper.openPosition({
            strategyId,
            ticker: rec.ticker,
            eventTicker: rec.eventTicker,
            eventTitle: rec.title,
            marketTitle: rec.subtitle,
            topic: rec.topic,
            side: intent.side,
            priceTicks: intent.priceTicks,
            contracts: intent.contracts,
            seriesTicker: rec.seriesTicker,
            reason: `${alert.kind} ${alert.direction} ${(Math.abs(alert.deltaTicks) / 10_000).toFixed(1)}c`,
            signalId: alert.id,
            fillsAs: intent.fillsAs,
            takeProfitTicks: intent.takeProfitTicks,
            stopTicks: intent.stopTicks,
            maxHoldMs: intent.maxHoldMs,
            atMs: alert.toTs
          });
          if (pos) this.emit('paperOpen', pos);
        }
      }
    }

    this.emit('alert', alert);
  }

  /**
   * Sum of YES prices across every market of a mutually exclusive event.
   * K11: mutually_exclusive true means "at most one market in this event can resolve
   * to yes", so a coherent set of YES prices sums to at most $1.00. Sums above
   * $1.00 + fees are an arbitrage-shaped condition; sums far below are a lottery
   * shaped one. We report the deviation, never assert it is free money.
   */
  siblingSum(rec) {
    const meta = this.eventMeta.get(rec.eventTicker);
    if (!meta) return null;
    const peers = [...this.index.markets.values()].filter((m) => m.eventTicker === rec.eventTicker);
    const priced = peers.filter((m) => m.lastTicks !== null && m.lastTicks !== undefined);
    if (priced.length < 2) return { sumYesTicks: null, count: priced.length, complete: false, mutuallyExclusive: Boolean(meta.mutuallyExclusive) };
    const sum = priced.reduce((n, m) => n + (m.lastTicks ?? 0), 0);
    return {
      sumYesTicks: sum,
      count: priced.length,
      complete: priced.length === peers.length && Boolean(meta.mutuallyExclusive),
      mutuallyExclusive: Boolean(meta.mutuallyExclusive),
      deviationTicks: sum - T
    };
  }

  /** Candidate cause links: the series' own settlement sources first (K12). */
  causesFor(rec) {
    const meta = this.eventMeta.get(rec.eventTicker);
    const sources = (meta?.settlementSources || []).filter((s) => s?.url).slice(0, 3).map((s) => ({
      title: s.name || s.url,
      url: s.url,
      kind: 'settlement_source'
    }));
    const topic = this.cfg.topics.topics[rec.topic];
    const feeds = (topic?.news_feeds || []).slice(0, 3).map((f) => ({ title: f.title, url: f.url, kind: 'topic_feed' }));
    const seen = new Set();
    return [...sources, ...feeds].filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });
  }

  onLifecycle(msg, ts) {
    const rec = this.index.get(msg.market_ticker);
    if (!rec) return;
    if (msg.event_type === 'determined') {
      rec.status = 'determined';
      rec.result = msg.result || rec.result;
      rec.settlementValueTicks = dollarsToTicks(msg.settlement_value);
      rec.determinedTs = msg.determination_ts || Math.floor(ts / 1000);
      this.#recordResolution(rec, 'determined', ts);
    } else if (msg.event_type === 'settled') {
      rec.status = 'settled';
      rec.settlementTs = msg.settled_ts || Math.floor(ts / 1000);
      if (rec.result) this.#recordResolution(rec, 'settled', ts);
    } else if (msg.event_type === 'close_date_updated') {
      rec.closeSec = msg.close_ts || rec.closeSec;
    } else if (msg.event_type === 'deactivated') {
      rec.status = 'paused';
    } else if (msg.event_type === 'activated') {
      rec.status = 'open';
    }

    // Paper positions settle on the first terminal message (K21 + K6: no settlement fee).
    if ((msg.event_type === 'determined' || msg.event_type === 'settled') && (msg.result || rec.result)) {
      const trades = this.paper.settleMarket(rec.ticker, {
        result: msg.result || rec.result,
        atMs: ts,
        marketTitle: rec.subtitle
      });
      for (const t of trades) this.emit('paperTrade', t);
    }
  }

  #recordResolution(rec, kind, ts) {
    if (!rec.result) return;
    const existing = this.resolutions.find((r) => r.ticker === rec.ticker);
    if (existing && existing.result === rec.result) return;
    const row = {
      id: nextId('res_'),
      ticker: rec.ticker,
      eventTicker: rec.eventTicker,
      eventTitle: rec.title,
      marketTitle: rec.subtitle,
      topic: rec.topic,
      topicReason: rec.topicReason,
      result: rec.result,
      settlementValueTicks: rec.settlementValueTicks,
      closeSec: rec.closeSec,
      determinedTs: rec.determinedTs,
      settledTs: rec.settlementTs,
      kind,
      observedAt: ts,
      source: 'market_lifecycle_v2 (K21)'
    };
    if (existing) Object.assign(existing, row);
    else this.resolutions.unshift(row);
    if (this.resolutions.length > 2000) this.resolutions.length = 2000;
    this.emit('resolution', row);
  }

  /* -------------------------------------------------------------- orderbook */
  async pollOrderbooks() {
    if (this.mode === 'mock') {
      for (const m of this.index.markets.values()) {
        const book = this.mock?.book(m.ticker);
        if (book) this.applyBook(m.ticker, book, Date.now());
      }
      return;
    }
    if (!this.rest) return;
    const tickers = [...this.index.markets.values()]
      .filter((m) => m.status === 'open')
      .slice(0, Math.min(40, this.cfg.poll.maxMarkets)); // one request per book; keep it polite (K4)
    for (const m of tickers) {
      try {
        const res = await this.rest.orderbook(m.ticker, 10);
        this.applyBook(m.ticker, res?.orderbook_fp || {}, Date.now());
      } catch (err) {
        if (err.code === 'network') throw err;
      }
    }
  }

  /* ---------------------------------------------------------------- account */
  async refreshLiveAccount() {
    if (!this.broker?.connected) return;
    try {
      const bal = await this.rest.balance();
      this.live.balanceTicks = dollarsToTicks(bal.balance_dollars);
      this.live.portfolioValueTicks = bal.portfolio_value != null ? Math.round((bal.portfolio_value / 100) * T) : null;
      this.live.lastBalanceAt = Date.now();
      const pos = await this.rest.positions({ countFilter: 'position', settlementStatus: 'all' });
      this.live.positions = (pos?.market_positions ?? []).map((p) => {
        const signed = countToCents100(p.position_fp) ?? 0;
        return {
          ticker: p.ticker,
          contracts: Math.abs(signed) / 100,
          side: signed > 0 ? 'yes' : signed < 0 ? 'no' : 'flat',
          exposureTicks: dollarsToTicks(p.market_exposure_dollars),
          realizedPnlTicks: dollarsToTicks(p.realized_pnl_dollars),
          feesPaidTicks: dollarsToTicks(p.fees_paid_dollars)
        };
      });
      this.live.connected = true;
      this.live.error = null;
    } catch (err) {
      this.live.connected = false;
      this.live.error = { message: err.message, code: err.code, at: Date.now() };
    }
  }

  /* ------------------------------------------------------------- reporting */
  topicView(topicId) {
    const list = this.index.byTopic(topicId);
    const events = new Map();
    for (const m of list) {
      const key = m.eventTicker || m.ticker;
      if (!events.has(key)) {
        events.set(key, {
          eventTicker: key,
          title: m.title,
          topic: m.topic,
          closesAt: m.closeSec,
          markets: [],
          dollarVolume: null,
          openInterest: null,
          resolved: null
        });
      }
      const ev = events.get(key);
      ev.markets.push(this.marketView(m));
      if (m.dollarVolume !== null) ev.dollarVolume = (ev.dollarVolume ?? 0) + m.dollarVolume;
      if (m.openInterestContracts !== null) ev.openInterest = (ev.openInterest ?? 0) + m.openInterestContracts;
      if (m.result === 'yes' || m.result === 'no') ev.resolved = m.result;
      if (m.closeSec && (!ev.closesAt || m.closeSec < ev.closesAt)) ev.closesAt = m.closeSec;
    }
    const evs = [...events.values()];
    evs.sort((a, b) => (b.dollarVolume ?? -1) - (a.dollarVolume ?? -1));
    return { topic: this.cfg.topics.topics[topicId], events: evs };
  }

  marketView(m) {
    return {
      ticker: m.ticker,
      eventTicker: m.eventTicker,
      title: m.title,
      subtitle: m.subtitle,
      status: m.status,
      closeSec: m.closeSec,
      yesBidTicks: m.yesBidTicks,
      yesAskTicks: m.yesAskTicks,
      lastTicks: m.lastTicks,
      yesBidSize: m.yesBidSize,
      yesAskSize: m.yesAskSize,
      volumeContracts: m.volumeContracts,
      openInterestContracts: m.openInterestContracts,
      dollarVolume: m.dollarVolume,
      liquidityTicks: m.liquidityTicks,
      result: m.result,
      settlementValueTicks: m.settlementValueTicks,
      book: m.book
        ? {
            yesLevels: m.book.yesLevels.slice(-10),
            noLevels: m.book.noLevels.slice(-10),
            ts: m.book.ts,
            source: m.book.source,
            summary: m.bookSummary
          }
        : null,
      points: m.points.slice(-600),
      topicReason: m.topicReason,
      rulesPrimary: m.rulesPrimary
    };
  }

  analytics() {
    const trades = this.paper.closed;
    const analysis = analyze(trades);
    const rankings = rankStrategies(trades, { minTrades: 10 });
    return {
      ...analysis,
      rankings,
      paper: this.paper.snapshot(),
      live: {
        connected: this.live.connected,
        balanceTicks: this.live.balanceTicks,
        portfolioValueTicks: this.live.portfolioValueTicks,
        positions: this.live.positions,
        lastBalanceAt: this.live.lastBalanceAt,
        error: this.live.error,
        credentialsPresent: hasCredentials()
      },
      reconcile: reconcile({ paper: this.paper.snapshot(), live: this.live })
    };
  }

  status() {
    return {
      mode: this.mode,
      modeReason: this.modeReason,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      environment: this.cfg.env,
      restBase: this.cfg.restBase,
      wsBase: this.cfg.wsBase,
      exchangeStatus: this.exchangeStatus || null,
      ws: this.ws?.status() ?? (this.mock ? this.mock.status() : null),
      rest: this.rest?.stats ?? null,
      discovery: this.discovery,
      alertStats: this.alerts.stats(),
      paper: {
        startTicks: this.paper.startTicks,
        cashTicks: this.paper.cashTicks,
        equityTicks: this.paper.equityTicks,
        realizedTicks: this.paper.realizedTicks,
        feesTicks: this.paper.feesTicks,
        openCount: this.paper.open.size,
        closedCount: this.paper.closed.length
      },
      live: {
        connected: this.live.connected,
        credentialsPresent: hasCredentials(),
        lastBalanceAt: this.live.lastBalanceAt,
        error: this.live.error
      },
      broker: this.broker?.statusSummary?.() ?? null,
      thresholds: {
        alertMoveDollars: this.cfg.alert.moveDollars,
        modelMinEdge: this.cfg.model.minEdge,
        modelMinLiquidity: this.cfg.model.minLiquidity
      },
      dataProvenance: provenance(this.mode)
    };
  }
}

/**
 * Machine-readable provenance, surfaced in the UI header. This is the guard against
 * a simulated number ever being mistaken for a real one.
 */
export function provenance(mode) {
  if (mode === 'live') {
    return {
      kind: 'live',
      label: 'LIVE · Kalshi demo',
      detail:
        'Prices, books and resolutions come from the Kalshi demo environment. Kalshi warns that demo market behaviour may not reflect real markets (K2).',
      sourceIds: ['K1', 'K2']
    };
  }
  if (mode === 'mock') {
    return {
      kind: 'simulated',
      label: 'SIMULATED · local fixture',
      detail:
        'No Kalshi connection was available, so this dashboard is running a local, seeded simulator that mimics the documented message shapes. None of these prices are Kalshi prices.',
      sourceIds: ['K18', 'K19', 'K21']
    };
  }
  return {
    kind: 'offline',
    label: 'OFFLINE',
    detail: 'No data source is connected. Nothing is being shown.',
    sourceIds: []
  };
}

function cfgKeyId(cfg) {
  return cfg.keyId || '';
}

export { fmtPrice };

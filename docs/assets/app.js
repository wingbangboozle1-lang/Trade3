// ============================================================================
// Trade3 shared core: Kalshi endpoint config, paced fetching, topic mapping.
// No build step, no dependencies, plain ES modules.
//
// Every endpoint and query shape used here is taken from Kalshi's official docs:
//   https://docs.kalshi.com/getting_started/api_environments
//   https://docs.kalshi.com/getting_started/quick_start_market_data
//   https://docs.kalshi.com/api-reference/market/get-markets
//   https://docs.kalshi.com/api-reference/events/get-events
//   https://docs.kalshi.com/api-reference/market/get-series-list
//   https://docs.kalshi.com/api-reference/market/get-market-orderbook
//   https://docs.kalshi.com/api-reference/market/get-market-candlesticks
// ============================================================================

export const DEMO_PRIMARY = "https://external-api.demo.kalshi.co/trade-api/v2";
export const DEMO_FALLBACK = "https://demo-api.kalshi.co/trade-api/v2"; // "also supported" per docs
export const PROD_PRIMARY = "https://external-api.kalshi.com/trade-api/v2";
export const PROD_FALLBACK = "https://api.elections.kalshi.com/trade-api/v2";

// Swing size that raises an alert (either direction), in dollars per contract.
export const ALERT_THRESHOLD = 0.10;

// High-ROI screen. These are *disclosed heuristics*, not a model and not advice.
// Each constant is shown on the Method page next to its rationale.
export const ROI = {
  minPrice: 0.15,      // skip near-certain / near-dead contracts
  maxPrice: 0.85,
  minMove: 0.05,       // needs a real move, not noise
  maxSpread: 0.10,     // must be tradeable
  minDollarVol: 250,   // must have real money behind it
  minDepth: 50,        // contracts resting within 3c of best bid
};

// The five topics the brief asks for, with the exact Kalshi filters that define
// them. `series` lists verified tickers (see docs/data/series.json); live
// discovery via GET /series?category=&tags= is merged on top at runtime.
export const TOPICS = [
  {
    id: "gas",
    label: "Gas prices",
    category: "Economics",
    tags: ["Oil and Gas", "Oil and energy"],   // matches both "Oil & Gas" and "Oil and energy"
    extraCategories: [],
    apiQuery: "series?category=Economics&tags=Oil and energy",
    site: "https://kalshi.com/markets/kxaaagasm",
    blurb: "Retail gasoline via AAA and natural gas via EIA.",
  },
  {
    id: "elections",
    label: "Elections",
    category: "Elections",
    tags: [],
    extraCategories: [],
    apiQuery: "series?category=Elections",
    site: "https://kalshi.com/markets/popvotekhva",
    blurb: "US and international elections, nominations and control of office.",
  },
  {
    id: "culture",
    label: "Culture",
    // CORRECTED 2026-11-20 by the integration session: Kalshi DOES have a Culture
    // discovery category. GET /series?category=Culture returned 2 series, both with
    // "category":"Culture" (KXXBANNEDGROK, KXXBANNEDMURRAYHILLGUY1). It is tiny and had
    // no open markets (GET /markets?series_ticker=KXXBANNEDGROK&status=open -> {"markets":[]}),
    // so Entertainment is kept as a *disclosed* superset instead of being the whole mapping.
    category: "Culture",
    extraCategories: ["Entertainment"],
    tags: [],
    apiQuery: "series?category=Culture",
    blurb: "Kalshi's Culture category (2 series as at 2026-11-20, none open) plus Entertainment, the nearest large category for music, awards, film, TV and games.",
    flag: "F1 (corrected): Culture is a real Kalshi category but has no open markets; Entertainment is included as a labelled superset so the page is not empty.",
  },
  {
    id: "crypto",
    label: "Crypto",
    category: "Crypto",
    tags: [],
    extraCategories: [],
    apiQuery: "series?category=Crypto",
    site: "https://kalshi.com/markets/kxbtcd",
    blurb: "BTC, ETH, SOL, XRP and other crypto price and milestone contracts.",
  },
  {
    id: "golf",
    label: "Golf",
    category: "Sports",
    tags: ["Golf"],
    extraCategories: [],
    apiQuery: "series?category=Sports&tags=Golf",
    site: "https://kalshi.com/markets/kxpgatour",
    blurb: "PGA/LPGA/team golf contracts, settled from tour and broadcast sources.",
  },
];

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const TOPIC_IDS = TOPICS.map((t) => t.id);

// ---------------------------------------------------------------------------
// Settings (persisted per browser; nothing is sent anywhere but Kalshi)
// ---------------------------------------------------------------------------
const LS = {
  env: "t3.env",
  proxy: "t3.proxy",
  poll: "t3.poll",
  paper: "t3.paper",
  alerts: "t3.alerts",
  roi: "t3.roi",
  series: "t3.seriesCache",
  sound: "t3.sound",
};

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(LS[key]);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(LS[key], JSON.stringify(value)); } catch { /* quota */ }
  },
};

export function getEnv() { return store.get("env", "demo"); }
export function setEnv(v) { store.set("env", v); }
export function getProxy() { return store.get("proxy", ""); }
export function setProxy(v) { store.set("proxy", (v || "").trim()); }
export function getPollMs() { return store.get("poll", 15000); }
export function setPollMs(v) { store.set("poll", v); }

/** Base URLs to try, in order. Public market data needs no API key. */
export function baseUrls() {
  return getEnv() === "prod" ? [PROD_PRIMARY, PROD_FALLBACK] : [DEMO_PRIMARY, DEMO_FALLBACK];
}

// ---------------------------------------------------------------------------
// HTTP: paced, retried, with host fallback and an optional user-supplied proxy.
// Kalshi's rate limits are token buckets (docs.kalshi.com/getting_started/rate_limits);
// we stay far under them by serialising requests and spacing them out.
// ---------------------------------------------------------------------------
const net = {
  active: 0,
  maxConcurrent: 3,
  minGapMs: 90,
  lastStart: 0,
  queue: [],
  base: null,          // full base URL that last answered, e.g. https://.../trade-api/v2
  okHost: null,        // its host, for display only
  stats: { requests: 0, errors: 0, lastError: null, lastOkAt: null, proxyUsed: false },
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function pump() {
  if (net.active >= net.maxConcurrent || !net.queue.length) return;
  const job = net.queue.shift();
  net.active++;
  job.run().finally(() => { net.active--; pump(); });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    net.queue.push({ run: () => fn().then(resolve, reject) });
    pump();
  });
}

/** Build the URL. A proxy, if configured, is applied as `<proxy><full-url>`. */
function buildUrl(path, params) {
  const host = net.base || baseUrls()[0];
  const qs = new URLSearchParams(params || {}).toString();
  const url = `${host}${path}${qs ? "?" + qs : ""}`;
  const proxy = getProxy();
  if (!proxy) return url;
  const joiner = proxy.includes("%s") ? proxy.replace("%s", encodeURIComponent(url))
    : proxy + (proxy.endsWith("/") ? "" : "/") + url;
  net.stats.proxyUsed = Boolean(proxy);
  return joiner;
}

/**
 * GET a public endpoint.
 * @param {string} path e.g. "/markets"
 * @param {object} params query params (strings/numbers only)
 * @param {object} opts { retries, signal, raw }
 */
export function apiGet(path, params = {}, opts = {}) {
  const retries = opts.retries ?? 2;
  return enqueue(async () => {
    let attempt = 0;
    let lastErr = null;
    while (attempt <= retries) {
      const gap = Math.max(0, net.minGapMs - (Date.now() - net.lastStart));
      if (gap) await sleep(gap);
      net.lastStart = Date.now();
      const url = buildUrl(path, params);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 12000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        clearTimeout(timer);
        net.stats.requests++;
        if (r.status === 429) {                       // rate limited: back off per docs
          await sleep(400 * Math.pow(2, attempt));
          lastErr = new Error(`HTTP 429 from ${hostOf(url)}`);
          attempt++; continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status} from ${hostOf(url)}`);
        net.base = baseUrls().find((b) => url.startsWith(b)) || net.base;
        net.okHost = hostOf(url);
        net.stats.lastOkAt = Date.now();
        net.stats.lastError = null;
        return await r.json();
      } catch (e) {
        lastErr = e;
        net.stats.errors++;
        net.stats.lastError = String(e && e.message || e);
        // Try the alternate documented base on the first failure, as the docs
        // describe, then keep using whichever one answered.
        if (!net.base && attempt === 0) {
          const alt = baseUrls()[1];
          if (alt) { net.base = alt; net.okHost = hostOf(alt); attempt++; continue; }
        }
        await sleep(300 * Math.pow(2, attempt));
        attempt++;
      }
    }
    throw lastErr || new Error("request failed");
  });
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url.slice(0, 40); }
}

export function netStats() {
  return { ...net.stats, host: net.okHost || hostOf(net.base || baseUrls()[0]), base: net.base || baseUrls()[0], queued: net.queue.length };
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/** Open events, paged. Used for the event→category map that drives topic grouping. */
export async function fetchOpenEvents({ maxPages = 3, onPage } = {}) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < maxPages; i++) {
    const data = await apiGet("/events", { status: "open", limit: 200, ...(cursor ? { cursor } : {}) });
    for (const e of data.events || []) out.push(e);
    if (onPage) onPage(out.length);
    cursor = data.cursor || "";
    if (!cursor) break;
  }
  return out;
}

/** Open markets, paged. Excludes multivariate combos so topics stay clean. */
export async function fetchOpenMarkets({ maxPages = 4, onPage } = {}) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < maxPages; i++) {
    const data = await apiGet("/markets", {
      status: "open", limit: 1000, mve_filter: "exclude", ...(cursor ? { cursor } : {}),
    });
    for (const m of data.markets || []) out.push(m);
    if (onPage) onPage(out.length);
    cursor = data.cursor || "";
    if (!cursor) break;
  }
  return out;
}

/** Settled markets for one series (used for resolution tracking). */
export async function fetchSettled(seriesTicker, limit = 12) {
  const data = await apiGet("/markets", { series_ticker: seriesTicker, status: "settled", limit });
  return data.markets || [];
}

/** Markets for one series (live prices, any status filter). */
export async function fetchSeriesMarkets(seriesTicker, status = "open", limit = 100) {
  const data = await apiGet("/markets", { series_ticker: seriesTicker, status, limit });
  return data.markets || [];
}

export async function fetchOrderbook(ticker, depth = 12) {
  const data = await apiGet(`/markets/${encodeURIComponent(ticker)}/orderbook`, { depth });
  return data.orderbook_fp || { yes_dollars: [], no_dollars: [] };
}

/**
 * Candlesticks. period_interval is minutes and must be 1, 60 or 1440, and one
 * request may span at most 5,000 periods (docs). We pick a legal interval per window.
 */
export async function fetchCandles(seriesTicker, ticker, startTs, endTs, periodInterval) {
  const data = await apiGet(
    `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
    { start_ts: Math.floor(startTs), end_ts: Math.floor(endTs), period_interval: periodInterval },
  );
  return data.candlesticks || [];
}

/** Legal (interval, span) pair for a length of time, honouring the 5,000-period cap. */
export function candlePlan(windowSeconds) {
  if (windowSeconds <= 86400) return { interval: 1, seconds: 60 };     // 1-min bars
  if (windowSeconds <= 7 * 86400) return { interval: 60, seconds: 3600 };
  return { interval: 1440, seconds: 86400 };
}

/** Discover the series belonging to a topic (cached ~10 min), merged with verified rows. */
const seriesCache = { at: 0, data: null };

export async function discoverTopicSeries(verified) {
  const fresh = seriesCache.data && Date.now() - seriesCache.at < 10 * 60 * 1000;
  if (fresh) return seriesCache.data;
  const out = {};
  for (const topic of TOPICS) {
    const set = new Map();
    for (const s of (verified?.[topic.id]?.series || [])) set.set(s.ticker, { ticker: s.ticker, title: s.title });
    const tags = topic.tags.length ? topic.tags : [null];
    // GET /series has no documented limit/cursor parameters (only category, tags,
    // include_product_metadata, include_volume, min_updated_ts), so `limit` is ignored by
    // the exchange — unknown query params are dropped silently, not rejected. We page
    // nothing and read the array it returns. See docs/methodology.html#series-params.
    for (const cat of [topic.category, ...(topic.extraCategories || [])]) {
    for (const tag of tags) {
      const params = { category: cat };
      if (tag && cat === topic.category) params.tags = tag;   // extras are category-only
      try {
        const data = await apiGet("/series", params);
        for (const s of data.series || []) {
          const cats = s.categories || [s.category];
          if (!cats.includes(cat)) continue;   // keep the topic honest
          if (cat !== topic.category && topic.tags.length) continue; // extras must not dodge the tag filter
          // A topic narrowed by tags only accepts series carrying one of those tags
          // ("Oil & Gas" / "Oil and energy" both normalise to "oil and gas").
          if (topic.tags.length) {
            const seriesTags = (s.tags || []).map(normTag);
            const wanted = topic.tags.map(normTag);
            if (!seriesTags.some((t) => wanted.includes(t))) continue;
          }
          if (!set.has(s.ticker)) set.set(s.ticker, { ticker: s.ticker, title: s.title, via: cat });
        }
      } catch { /* keep whatever we already have; surfaced in the status bar */ }
    }
    }
    out[topic.id] = set;
  }
  seriesCache.at = Date.now();
  seriesCache.data = out;
  return out;
}

export function normTag(t) {
  return String(t || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Assign every open market to one of the five topics, or to null.
 * Markets do not carry a category, but their event does, and the event also
 * gives us the series ticker — so classification is exact, not guessed.
 */
export function classify(markets, events, topicSeries) {
  const eventMeta = new Map();
  for (const e of events) {
    eventMeta.set(e.event_ticker, { category: e.category, series: e.series_ticker, title: e.title, sub: e.sub_title });
  }
  const out = [];
  for (const m of markets) {
    const meta = eventMeta.get(m.event_ticker);
    if (!meta) continue;
    // A topic accepts its own category and any *declared* superset category (culture is the
    // only one today: Kalshi's Culture category is real but empty of open markets). The
    // superset is remembered on the row so the UI can label it instead of hiding it.
    let hit = null, viaSuperset = false;
    for (const t of TOPICS) {
      const cats = [t.category, ...(t.extraCategories || [])];
      if (!cats.includes(meta.category)) continue;
      if (!topicSeries[t.id]?.has(meta.series)) continue;
      hit = t; viaSuperset = meta.category !== t.category; break;
    }
    const topic = hit;
    if (!topic) continue;
    out.push({
      ...m,
      _topic: topic.id,
      _category: meta.category,
      _viaSuperset: viaSuperset,
      _series: meta.series,
      _eventTitle: meta.title,
      _eventSub: meta.sub,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbers. Kalshi returns fixed-point **strings** in dollars ("0.4200").
// ---------------------------------------------------------------------------

/** Best YES bid, or null when the book side is empty. */
export function yesBid(m) { return num(m?.yes_bid_dollars); }
/** Best YES ask, or null. */
export function yesAsk(m) { return num(m?.yes_ask_dollars); }
export function lastPrice(m) {
  const p = num(m?.last_price_dollars);
  if (p != null) return p;
  const b = yesBid(m);
  return b == null ? null : b;
}

export function num(v) {
  if (v == null || v === "") return null;
  const f = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(f) ? f : null;
}

/**
 * Threshold comparisons run in integer 1/10,000-dollar space ("ticks").
 * Kalshi prices are fixed-point dollar strings, and float subtraction drifts
 * (0.42 − 0.32 = 0.09999999999999998), which would silently drop an
 * exactly-$0.10 move. Mirrors the `_ticks()` helper in strategies.py.
 */
export function ticks(x) {
  const f = num(x);
  return f == null ? null : Math.round(f * 10000);
}

/** Tick delta from `from` to `to` (positive = price rose), or null. */
export function movedTicks(from, to) {
  const a = ticks(from), b = ticks(to);
  return a == null || b == null ? null : b - a;
}

/** True when the move from `from` to `to` is ≥ the alert threshold, either direction. */
export function isSwing(from, to) {
  const d = movedTicks(from, to);
  return d != null && Math.abs(d) >= ticks(ALERT_THRESHOLD);
}

/**
 * Traded dollars = contracts × price, per contract side.
 * Kalshi exposes volume as a contract count and prices separately, and has no
 * dollar-volume field, so this is a *disclosed approximation* (flagged F4).
 */
export function dollarVolume(m) {
  const vol = num(m?.volume_fp) ?? num(m?.volume_24h_fp) ?? 0;
  const px = lastPrice(m) ?? 0;
  return vol * px;
}

/** Contracts still resting on the book, both sides. */
export function bookDepth(ob) {
  const sum = (arr) => (arr || []).reduce((a, [, q]) => a + (num(q) || 0), 0);
  return { yes: sum(ob?.yes_dollars), no: sum(ob?.no_dollars), total: sum(ob?.yes_dollars) + sum(ob?.no_dollars) };
}

/** Best bid/ask plus implied asks, per the reciprocal rule in Kalshi's docs. */
export function bookSummary(ob) {
  const best = (arr) => {
    const rows = (arr || []).filter(([p]) => num(p) != null);
    return rows.length ? num(rows[rows.length - 1][0]) : null;   // arrays are ascending
  };
  const yb = best(ob?.yes_dollars);
  const nb = best(ob?.no_dollars);
  const yesBidPx = yb;
  const yesAskPx = nb == null ? null : 1 - nb;   // NO bid at Y == YES ask at 1-Y
  const noBidPx = nb;
  const noAskPx = yb == null ? null : 1 - yb;
  const spread = yesBidPx != null && yesAskPx != null ? yesAskPx - yesBidPx : null;
  return { yesBid: yesBidPx, yesAsk: yesAskPx, noBid: noBidPx, noAsk: noAskPx, spread };
}

/** Contracts within `cents` of the best bid on the YES side. */
export function depthWithin(ob, cents = 0.03, side = "yes") {
  const arr = (side === "yes" ? ob?.yes_dollars : ob?.no_dollars) || [];
  if (!arr.length) return 0;
  const bestPx = num(arr[arr.length - 1][0]);
  return arr.filter(([p]) => num(p) != null && bestPx - num(p) <= cents)
    .reduce((a, [, q]) => a + (num(q) || 0), 0);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
/**
 * Kalshi puts markdown emphasis inside some titles, e.g. "Will average **gas prices** be
 * above $5.00?" (live GET /markets?series_ticker=KXAAAGASM, 2026-11-20). The API is the
 * source of truth for wording, so we only strip the emphasis markers — never the words.
 */
export function cleanTitle(t) {
  return String(t == null ? "" : t)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * GET /markets/trades — the documented filters are `ticker`, `limit`, `cursor`, `min_ts`,
 * `max_ts`, `is_block_trade` (docs.kalshi.com/api-reference/market/get-trades). There is no
 * `market_ticker` filter, and unrecognised query params are ignored by the exchange rather
 * than rejected, so we ALSO filter client-side: a mistyped filter would otherwise return
 * the whole tape and look like it belonged to the market.
 * min_ts / max_ts are Unix SECONDS (millisecond values are answered with 400 bad_request).
 */
export async function fetchTrades(ticker, { fromTs, toTs, limit = 100 } = {}) {
  const params = { ticker, limit };
  if (fromTs != null) params.min_ts = Math.floor(fromTs / 1000);
  if (toTs != null) params.max_ts = Math.ceil(toTs / 1000);
  const data = await apiGet("/markets/trades", params);
  const all = data.trades || [];
  const mine = all.filter((t) => t.ticker === ticker);
  return { trades: mine, fetched: all.length, filteredOut: all.length - mine.length };
}

/** Official settlement-source links for a series record, deduped, blanks dropped. */
export function sourceLinks(rec) {
  const out = [];
  const seen = new Set();
  for (const src of (rec && rec.settlement_sources) || []) {
    const url = (src && src.url || "").trim();
    const name = (src && src.name || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    if (/\/\/kalshi\.com\/?$/i.test(url)) continue;  // placeholder self-links carry no information
    seen.add(url);
    out.push({ name: cleanTitle(name) || url.replace(/^https?:\/\//, "").split("/")[0], url });
  }
  return out;
}

export function fmtPx(p) { return p == null ? "—" : "$" + Number(p).toFixed(2); }
export function fmtPct(p) { return p == null ? "—" : Math.round(p * 100) + "¢"; }
export function fmt$(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(abs < 10 ? 2 : 0);
}
export function fmtDelta(n) { return n == null ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(0) + "¢"; }
export function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function timeStr(ts, seconds = true) {
  if (ts == null) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}),
  });
}

export function clockStr(ts) {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "3d 4h", "12m", "45s" — how long until a market closes. */
export function until(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + (Math.floor(s / 60) % 60) + "m";
  return Math.floor(s / 86400) + "d " + (Math.floor(s / 3600) % 24) + "h";
}

/**
 * Public Kalshi page for a series. Kalshi's web URLs are /markets/<lowercased
 * series ticker> (verified for KXAAAGASM, KXETHD, KXPGATOUR, KXPRESNOMD).
 * Returns null when we cannot be sure the page exists, so callers can fall back
 * to the API record instead of shipping a dead link.
 */
export function kalshiSeriesUrl(seriesTicker) {
  if (!seriesTicker) return null;
  return `https://kalshi.com/markets/${String(seriesTicker).toLowerCase()}`;
}

export function apiSeriesUrl(ticker) {
  return `${(net.base || baseUrls()[0])}/series/${encodeURIComponent(ticker)}`;
}

export function apiMarketUrl(ticker) {
  return `${(net.base || baseUrls()[0])}/markets/${encodeURIComponent(ticker)}`;
}

export function apiEventUrl(ticker) {
  return `${(net.base || baseUrls()[0])}/events/${encodeURIComponent(ticker)}`;
}

// ---------------------------------------------------------------------------
// High-ROI screen (explicit, auditable)
// ---------------------------------------------------------------------------
export function roiCheck({ price, delta, spread, dollarVol, depth }) {
  const reasons = [];
  if (price == null) reasons.push("no price");
  else if (price < ROI.minPrice || price > ROI.maxPrice) reasons.push(`price outside $${ROI.minPrice.toFixed(2)}–$${ROI.maxPrice.toFixed(2)}`);
  if (delta == null || Math.abs(delta) < ROI.minMove) reasons.push(`move < $${ROI.minMove.toFixed(2)}`);
  if (spread != null && spread > ROI.maxSpread) reasons.push(`spread > $${ROI.maxSpread.toFixed(2)}`);
  if ((dollarVol ?? 0) < ROI.minDollarVol) reasons.push(`$ volume < $${ROI.minDollarVol}`);
  if (depth != null && depth < ROI.minDepth) reasons.push(`depth < ${ROI.minDepth} contracts`);
  return { pass: reasons.length === 0, reasons };
}

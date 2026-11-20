/**
 * Topic classification for the five requested topics only:
 * gas prices, elections, culture, crypto, golf.
 *
 * PRIMARY SIGNAL — official Kalshi metadata, read live from GET /series/{ticker}
 * and GET /series?category=... :
 *   - `category`       e.g. "Crypto", "Elections", "Culture", "Sports", "Economics"
 *   - `tags`           e.g. ["Golf"], ["Oil & Gas","Oil and energy"], ["Crypto","Bitcoin"]
 *   - `product_metadata.scope` e.g. "Gasoline"
 *
 * Verified examples (demo API, 2026-11-20) that drove the rules below:
 *   KXAAAGASM  category "Economics",  tags ["Oil & Gas","Oil and energy"], scope "Gasoline"
 *   KXPGATOUR  category "Sports",     tags ["Golf"]
 *   KXBTCD     category "Crypto",     tags ["Crypto","Hourly","Bitcoin"]
 *   GOVPARTYVA category "Elections",  tags ["Governor"]
 *   KXXBANNEDGROK category "Culture"
 *
 * SECONDARY SIGNAL — a keyword match on the market title/ticker, used only when the
 * official metadata is missing or too coarse. Both signals are reported back as a
 * `reason` string so the dashboard can show exactly why a market was bucketed.
 *
 * A topic is never invented for a market; if nothing matches, the market is dropped
 * from the dashboard rather than being forced into a bucket.
 */

export const TOPICS = Object.freeze([
  {
    id: 'gas',
    label: 'Gas Prices',
    color: '#f59e0b',
    blurb: 'US retail gasoline price thresholds. Kalshi series KXAAAGASM settles on AAA data.',
    // Verified from GET /series/KXAAAGASM
    seriesTags: ['oil & gas', 'oil and energy', 'gasoline', 'gas'],
    seriesScopes: ['gasoline'],
    keywords: ['gas price', 'gas prices', 'gasoline', 'aaa gas', 'average gas'],
    // "Gas" the category does not exist on Kalshi (GET /series?category=Gas -> null),
    // so the gas topic is driven by tag/scope only. Recorded on the Flagged page.
    seriesCategories: ['Economics'],
  },
  {
    id: 'elections',
    label: 'Elections',
    color: '#3b82f6',
    blurb: 'US and international elections, primaries, nominations and vote counts.',
    seriesTags: ['us elections', 'governor', 'primaries', 'international elections', 'politics'],
    seriesScopes: [],
    keywords: ['election', 'senate', 'governor', 'primary', 'nominee', 'ballot', 'parliament', 'referendum'],
    seriesCategories: ['Elections'],
  },
  {
    id: 'culture',
    label: 'Culture',
    color: '#a855f7',
    blurb: 'Kalshi Culture category (verified: GET /series?category=Culture returns series), plus Entertainment — awards, music, film, celebrity and viral-moment markets.',
    seriesTags: ['ai', 'entertainment', 'pop culture', 'awards', 'music', 'movies', 'tv'],
    seriesScopes: [],
    keywords: ['oscar', 'grammy', 'emmy', 'box office', 'best picture', 'album', 'celebrity', 'banned from x'],
    seriesCategories: ['Culture'],
  },
  {
    id: 'crypto',
    label: 'Crypto',
    color: '#f97316',
    blurb: 'Bitcoin, Ethereum and altcoin price thresholds. Crypto series settle on CF Benchmarks indices.',
    seriesTags: ['crypto', 'bitcoin', 'ethereum', 'hourly', 'altcoins'],
    seriesScopes: [],
    keywords: ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'crypto', 'btc', 'eth price'],
    seriesCategories: ['Crypto'],
  },
  {
    id: 'golf',
    label: 'Golf',
    color: '#22c55e',
    blurb: 'PGA Tour tournament winners, cuts and round leaders.',
    // Verified from GET /series/KXPGATOUR -> category "Sports", tags ["Golf"].
    seriesTags: ['golf', 'pga', 'lpga'],
    seriesScopes: [],
    keywords: ['golf', 'pga tour', 'masters', 'rsm classic', 'ryder cup', 'lpga'],
    seriesCategories: [],
  },
]);

const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

export function topicById(id) {
  return TOPIC_BY_ID.get(id) || null;
}

/**
 * Classify one market.
 * @param {object} market market object from GET /markets
 * @param {object} ctx    { seriesTicker, category, tags, scope, seriesTitle }
 * @returns {{topicId: string, reason: string}|null}
 */
export function classifyMarket(market, ctx = {}) {
  const category = norm(ctx.category);
  const tags = (ctx.tags ?? []).map(norm);
  const scope = norm(ctx.scope);
  const title = norm([market.title, market.yes_sub_title, market.ticker].filter(Boolean).join(' '));
  const seriesTicker = norm(ctx.seriesTicker ?? '');

  // 1. Official tag match. Golf and gas are decided by tag/scope because their
  //    Kalshi categories (Sports, Economics) are far too broad.
  for (const topic of ['golf', 'gas']) {
    const t = TOPIC_BY_ID.get(topic);
    if (tags.some((tag) => t.seriesTags.includes(tag))) return { topicId: topic, reason: 'kalshi_series_tag' };
    if (scope && t.seriesScopes.includes(scope)) return { topicId: topic, reason: 'kalshi_product_scope' };
  }

  // 2. Official category match (1:1 categories only).
  const byCategory = { crypto: 'crypto', elections: 'elections', culture: 'culture' };
  if (byCategory[category]) return { topicId: byCategory[category], reason: 'kalshi_series_category' };

  // 3. Official tag match for the remaining topics.
  for (const topic of ['elections', 'culture', 'crypto']) {
    const t = TOPIC_BY_ID.get(topic);
    if (tags.some((tag) => t.seriesTags.includes(tag))) return { topicId: topic, reason: 'kalshi_series_tag' };
  }

  // 4. Keyword fallback on the market title, whole-word only.
  for (const t of TOPICS) {
    if (t.keywords.some((k) => boundaryMatch(title, norm(k)))) return { topicId: t.id, reason: 'keyword' };
  }

  // 5. Series ticker prefix, e.g. KXPGATOUR..., KXBTCD..., KXAAAGASM...
  for (const t of TOPICS) {
    if (t.keywords.some((k) => {
      const key = norm(k).replace(/\s+/g, '');
      return key.length >= 5 && seriesTicker.startsWith(key);
    })) {
      return { topicId: t.id, reason: 'series_ticker' };
    }
  }

  return null;
}

/**
 * Whole-word / whole-phrase match, tolerant of a trailing plural "s".
 * Prevents false positives such as "participation" matching "par" while still
 * letting "gas price" match "gas prices".
 */
function boundaryMatch(haystack, needle) {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}s?([^a-z0-9]|$)`).test(haystack);
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Extract the official classification metadata from a series object. */
export function seriesMeta(series) {
  if (!series) return {};
  return {
    category: series.category ?? null,
    tags: Array.isArray(series.tags) ? series.tags : [],
    scope: series.product_metadata?.scope ?? null,
    title: series.title ?? null,
  };
}

/**
 * Official Kalshi link for a market. The verified, stable URL is the API record:
 * GET /markets/{ticker} (https://docs.kalshi.com/api-reference/market/get-market).
 * The demo web-UI pattern (https://demo.kalshi.co/markets/{ticker}) could not be
 * verified from an official source (the demo site is a client-side app), so it is
 * exposed separately as kalshiDemoUiUrl() and flagged as unverified — see F8/F9 on
 * the Flagged for Review pages.
 */
export function kalshiMarketUrl(ticker, env = 'demo') {
  const base = env === 'demo'
    ? 'https://external-api.demo.kalshi.co/trade-api/v2'
    : 'https://external-api.kalshi.com/trade-api/v2';
  return `${base}/markets/${encodeURIComponent(ticker)}`;
}

/** Convenience link to the demo web UI. UNVERIFIED URL pattern — flagged, not used as a primary source link. */
export function kalshiDemoUiUrl(ticker, env = 'demo') {
  return env === 'demo'
    ? `https://demo.kalshi.co/markets/${encodeURIComponent(ticker)}`
    : `https://kalshi.com/markets/${encodeURIComponent(ticker)}`;
}

/** Kalshi UI link for an event ticker. */
export function kalshiEventUrl(eventTicker, env = 'demo') {
  return env === 'demo'
    ? `https://demo.kalshi.co/events/${encodeURIComponent(eventTicker)}`
    : `https://kalshi.com/events/${encodeURIComponent(eventTicker)}`;
}

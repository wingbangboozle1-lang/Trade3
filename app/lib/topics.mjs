// Topic classification: map a Kalshi series/event/market onto exactly one of the
// five requested topics (gas prices, elections, culture, crypto, golf).
//
// Rules are data, not code: research/topics.json holds series prefixes, keywords
// and category names. Every rule carries a source_id in that file, and the seeds
// were read from official Kalshi pages (K6 fee schedule for the series names,
// K12 for the existence of series metadata).
//
// Classification is deliberately conservative: a market with no matching rule is
// NOT forced into a topic. It appears in the "unclassified" debug view instead of
// polluting a topic page, because putting an event in the wrong topic is worse
// than leaving it out.

import { config } from '../config.mjs';

function normalize(s) {
  return String(s || '').toLowerCase();
}

export class TopicClassifier {
  constructor(topicsDoc = config.topics) {
    this.doc = topicsDoc;
    this.topics = Object.entries(topicsDoc.topics).map(([id, t]) => ({ id, ...t }));
  }

  get ids() {
    return this.topics.map((t) => t.id);
  }

  get(id) {
    return this.topics.find((t) => t.id === id) || null;
  }

  /**
   * Classify. Precedence: explicit series prefix > series category > keyword in
   * title/subtitle. Returns { id, reason } or null.
   *
   * `evidence` strings are user-visible ("matched series prefix KXAAAGAS"), so a
   * trader can see why an event landed in a topic.
   */
  classify({ seriesTicker = '', eventTitle = '', marketTitle = '', categories = [], tags = [] } = {}) {
    const s = String(seriesTicker || '').toUpperCase();

    // 1. Series prefix (strongest signal; ticker structure is stable).
    if (s) {
      // Longest prefix wins so KXAAAGASM is not shadowed by KXAAAGAS.
      let best = null;
      for (const t of this.topics) {
        for (const prefix of t.rules.series_prefixes || []) {
          const p = prefix.toUpperCase();
          if (s.startsWith(p) && (!best || p.length > best.prefix.length)) {
            best = { id: t.id, prefix: p };
          }
        }
      }
      if (best) return { id: best.id, reason: `series prefix ${best.prefix}`, confidence: 'high' };
    }

    // 2. Kalshi category (exact, case-insensitive; K12 notes category matching on
    //    the API is case-sensitive and uses primary category, so we compare loosely
    //    against the categories we asked for).
    const cats = (categories || []).map(normalize);
    for (const t of this.topics) {
      for (const c of t.rules.categories || []) {
        if (cats.includes(normalize(c))) {
          return { id: t.id, reason: `category "${c}"`, confidence: 'medium' };
        }
      }
    }

    // 3. Keyword in the event/market title.
    const hay = `${normalize(eventTitle)} ${normalize(marketTitle)}`;
    if (hay.trim()) {
      for (const t of this.topics) {
        for (const kw of t.rules.keywords || []) {
          const k = normalize(kw);
          // word-boundary-ish match so "gas" does not match "gasket"
          const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
          if (re.test(hay)) {
            return { id: t.id, reason: `keyword "${kw}"`, confidence: 'low' };
          }
        }
      }
    }

    // 4. Tags (K12: tags describe subjects; several series can share them).
    const tagList = (tags || []).map(normalize);
    for (const t of this.topics) {
      for (const c of t.rules.categories || []) {
        if (tagList.includes(normalize(c))) {
          return { id: t.id, reason: `tag "${c}"`, confidence: 'low' };
        }
      }
    }

    return null;
  }

  /** The ordered list of topic definitions the UI renders (one page per topic). */
  list() {
    return this.topics.map((t) => ({
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      color: t.color,
      seriesPrefixes: t.rules.series_prefixes || [],
      keywords: t.rules.keywords || [],
      seedSeries: t.seed_series || [],
      newsFeeds: t.news_feeds || []
    }));
  }
}

export const classifier = new TopicClassifier();

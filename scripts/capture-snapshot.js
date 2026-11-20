#!/usr/bin/env node
/**
 * Capture a labelled snapshot of the Kalshi demo API into data/snapshot.json.
 *
 * Why this exists: `npm run snapshot` was declared in package.json but the file was missing, so
 * the command could not run at all. It is now implemented against the same code path the collector
 * uses, so a snapshot and a live poll cannot disagree about what a topic is.
 *
 * Rules, deliberately narrow:
 *   1. Market records are stored **exactly as the API returned them**. Nothing is renamed, rounded,
 *      filled or derived. `#pollSnapshot()` in the collector re-reads these raw fields.
 *   2. A topic is only ever assigned from official series metadata via `classifyMarket()`
 *      (GET /series/{ticker}) — the same rule the live collector uses.
 *   3. Ranking uses volume_fp × last price, the disclosed approximation the site documents (flag F4).
 *   4. If the exchange cannot be reached, this script **fails**. It never writes synthetic data, and
 *      it never writes a partial file.
 *
 * Usage:
 *   node scripts/capture-snapshot.js                     # write data/snapshot.json (demo, top 3/topic)
 *   node scripts/capture-snapshot.js --dry-run --json    # print what would be written, write nothing
 *   node scripts/capture-snapshot.js --env production --top 5  # read-only production market data
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KalshiClient, ENVIRONMENTS, round4 } from '../server/kalshi.js';
import { seriesMeta, classifyMarket, TOPICS } from '../server/topics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'snapshot.json');

/** Base each environment's proof URLs are quoted against (docs.kalshi.com/getting_started/api_environments). */
const SOURCES_BASE = {
  demo: 'https://external-api.demo.kalshi.co/trade-api/v2',
  production: 'https://external-api.kalshi.com/trade-api/v2',
};

/** seriesTickerOf, mirrored from server/collector.js (the collector keeps it private). */
export function seriesTickerOf(market) {
  const et = market?.event_ticker ?? '';
  const idx = et.indexOf('-');
  return idx > 0 ? et.slice(0, idx) : et;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Dollars traded, per the disclosed approximation (flag F4). Null when the API gave no price or
 * no volume — never 0, which would read as "no money here" instead of "not reported".
 * Rounded with round4(), Kalshi's 4-dp fixed-point convention (getting_started/fee_rounding), so
 * float noise (55571.52 x 0.03 = 1667.1455999999998) never reaches a table or a sort.
 */
export function dollars(market) {
  const vol = num(market.volume_fp);
  const px = num(market.last_price_dollars) ?? num(market.yes_bid_dollars);
  if (vol === null || px === null) return null;
  return round4(vol * px);
}

/**
 * Pure transform: raw API responses in, snapshot document out. Exported so the offline test can
 * exercise it without any network — the whole point of the file it writes must be checkable here.
 */
export function buildSnapshot({ env, rawMarkets, seriesRecords, exchangeStatus, topPerTopic, capturedAt }) {
  const bySeries = new Map(seriesRecords.map((s) => [s.ticker, s]));
  const sources = [];
  const picked = [];
  const perTopic = new Map(TOPICS.map((t) => [t.id, []]));

  for (const m of rawMarkets) {
    if (m.mve_collection_ticker) continue;           // basket tickets are not events
    const seriesTicker = seriesTickerOf(m);
    const rec = bySeries.get(seriesTicker);
    if (!rec) continue;                               // official metadata only — never a guess
    const match = classifyMarket(m, { seriesTicker, ...seriesMeta(rec) });
    if (!match) continue;
    perTopic.get(match.topicId)?.push({ market: m, match, seriesTicker, d: dollars(m) });
  }

  for (const [topicId, rows] of perTopic) {
    const keep = rows
      .sort((a, b) => (b.d ?? -1) - (a.d ?? -1))
      .slice(0, topPerTopic);
    for (const r of keep) {
      picked.push(r.market);                          // RAW record, untouched
      sources.push(`${SOURCES_BASE[env] ?? SOURCES_BASE.demo}/markets?series_ticker=${encodeURIComponent(r.seriesTicker)}&status=open`);
    }
  }

  const seriesOut = {};
  for (const rec of seriesRecords) {
    if (!picked.some((m) => seriesTickerOf(m) === rec.ticker)) continue;
    seriesOut[rec.ticker] = seriesMeta(rec);
  }

  const topicCounts = {};
  for (const m of picked) {
    const t = classifyMarket(m, { seriesTicker: seriesTickerOf(m), ...seriesMeta(bySeries.get(seriesTickerOf(m))) });
    if (t) topicCounts[t.topicId] = (topicCounts[t.topicId] ?? 0) + 1;
  }

  return {
    capturedAt,
    environment: env,
    note:
      'Real values read from the Kalshi demo Trade API by scripts/capture-snapshot.js. Market records are ' +
      'stored exactly as the API returned them — no field is renamed, derived or filled. Used only when the ' +
      'live API cannot be reached, and always labelled "snapshot" in the UI.',
    exchangeStatus: exchangeStatus
      ? {
          exchange_active: exchangeStatus.exchange_active ?? null,
          trading_active: exchangeStatus.trading_active ?? null,
          shards: (exchangeStatus.exchange_index_statuses ?? []).map((s) => s.exchange_index),
        }
      : null,
    topicCounts,
    sources: [...new Set(sources)],
    series: seriesOut,
    markets: picked,
  };
}

async function main(argv) {
  const get = (flag, def) => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
  };
  const env = get('env', 'demo');
  const topPerTopic = Number(get('top', '3'));
  const seriesCap = Number(get('series-cap', '120'));
  const out = path.resolve(ROOT, get('out', path.relative(ROOT, DEFAULT_OUT)));
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');

  if (!ENVIRONMENTS[env]) {
    console.error(`unknown --env ${env} (expected: ${Object.keys(ENVIRONMENTS).join(', ')})`);
    return 2;
  }
  const client = new KalshiClient({ env });

  let exchangeStatus = null;
  let rawMarkets = [];
  const seriesRecords = [];

  try {
    exchangeStatus = await client.exchangeStatus();
    if (exchangeStatus && exchangeStatus.exchange_active === false) {
      throw new Error('exchange_active is false — captured prices could not move, so a dead snapshot must never be written');
    }
    const page = await client.allMarkets({ status: 'open', limit: 1000 }, { maxPages: 4 });
    rawMarkets = Array.isArray(page) ? page : (page?.markets ?? []);
    if (!rawMarkets.length) throw new Error('GET /markets?status=open returned no markets');

    // Series metadata comes from the category lists FIRST (a handful of requests — the way
    // server/collector.js seeds its cache); only for a series still unknown do we fall back to a
    // per-ticker GET /series/{ticker}, capped so the capture stays inside the rate budget.
    // A market whose series record cannot be read is dropped by buildSnapshot() — never guessed.
    const SERIES_CATEGORIES = ['Crypto', 'Elections', 'Culture', 'Sports', 'Economics', 'Politics', 'Entertainment', 'Financials'];
    const seenSeries = new Set();
    for (const category of SERIES_CATEGORIES) {
      try {
        const data = await client.seriesList({ category });
        for (const sr of data?.series ?? []) {
          if (sr?.ticker && !seenSeries.has(sr.ticker)) { seenSeries.add(sr.ticker); seriesRecords.push(sr); }
        }
      } catch { /* an unreadable category contributes no series; its markets then drop out */ }
    }
    const ranked = [...rawMarkets].sort((a, b) => (num(b.volume_fp) ?? 0) - (num(a.volume_fp) ?? 0));
    let extra = 0;
    for (const m of ranked) {
      if (extra >= seriesCap) break;
      const t = seriesTickerOf(m);
      if (!t || seenSeries.has(t)) continue;
      extra += 1;
      try {
        const rec = await client.series(t);
        if (rec?.series) { seenSeries.add(t); seriesRecords.push(rec.series); }
      } catch {
        /* unreadable series => its markets classify to nothing; never invented */
      }
    }
  } catch (err) {
    console.error(
      `\ncapture aborted: the exchange could not be read (${err.message}).\n` +
      'This script refuses to write synthetic or partial data. Check outbound HTTPS to the demo host,\n' +
      'or run it where the API is reachable (e.g. a CI runner — see .github/workflows/verify-live.yml).\n'
    );
    return 1;
  }

  const snap = buildSnapshot({
    env,
    rawMarkets,
    seriesRecords,
    exchangeStatus,
    topPerTopic,
    capturedAt: new Date().toISOString(),
  });

  if (asJson) console.log(JSON.stringify(snap, null, 2));
  else {
    const counts = Object.entries(snap.topicCounts).map(([k, v]) => `${k}:${v}`).join(' ') || 'none';
    console.log(`capturedAt ${snap.capturedAt} · ${snap.markets.length} markets (${counts}) · ${Object.keys(snap.series).length} series · from ${client.base}`);
    if (snap.exchangeStatus) {
      console.log(`exchange_active=${snap.exchangeStatus.exchange_active} trading_active=${snap.exchangeStatus.trading_active} shards=[${snap.exchangeStatus.shards}]`);
    }
  }

  if (dryRun) {
    console.log('--dry-run: nothing written.');
    return 0;
  }
  if (!snap.markets.length) {
    console.error('refusing to write an empty snapshot — the API returned no classifiable open markets.');
    return 1;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, out)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

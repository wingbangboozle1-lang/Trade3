/**
 * Capture a snapshot of real Kalshi demo values into data/snapshot.json.
 *
 * This is what the `snapshot` data mode replays (DATA_MODE=snapshot). The file contains
 * only values actually returned by the demo Trade API at capture time, plus the URLs that
 * produced them. Nothing is invented: markets that do not classify into the five topics
 * are excluded, and series metadata is stored exactly as GET /series returns it.
 *
 * Usage:
 *   npm run snapshot            # writes data/snapshot.json
 *   DATA_MODE must NOT matter here — this script always talks to the live demo API.
 *
 * Run it on a network that can reach https://external-api.demo.kalshi.co (the build
 * sandbox cannot; see the Flagged for Review page).
 */

import fs from 'node:fs';
import path from 'node:path';
import { KalshiClient } from '../server/kalshi.js';
import { classifyMarket, seriesMeta } from '../server/topics.js';

// Keep in sync with server/collector.js SERIES_CATEGORIES (verified via GET /series?category=...;
// "Gas" and "Golf" are NOT categories — gas is Economics + Oil & Gas tag, golf is Sports + Golf tag).
const SERIES_CATEGORIES = [
  'Crypto',
  'Elections',
  'Culture',
  'Sports',
  'Economics',
  'Politics',
  'Entertainment',
  'Financials',
];

const TOPIC_IDS = new Set(['gas', 'elections', 'culture', 'crypto', 'golf']);

function seriesTickerOf(market) {
  const et = market.event_ticker ?? '';
  const idx = et.indexOf('-');
  return idx > 0 ? et.slice(0, idx) : et;
}

async function main() {
  const client = new KalshiClient({ env: 'demo', onLog: (lvl, msg) => console[lvl]?.(msg) });
  const outPath = path.join(process.cwd(), 'data', 'snapshot.json');

  console.log('checking exchange status…');
  const status = await client.exchangeStatus();
  if (!status?.exchange_active) {
    console.warn('exchange_active is false — captured prices will not move; aborting so a dead snapshot is never written.');
    process.exit(1);
  }

  console.log('refreshing series metadata…');
  const seriesMetaMap = new Map();
  for (const category of SERIES_CATEGORIES) {
    try {
      const data = await client.seriesList({ category });
      for (const s of data?.series ?? []) {
        if (s?.ticker) seriesMetaMap.set(s.ticker, seriesMeta(s));
      }
      console.log(`  category ${category}: +${(data?.series ?? []).length}`);
    } catch (err) {
      console.warn(`  category ${category} failed: ${err.message}`);
    }
  }

  console.log('fetching open markets…');
  const markets = await client.allMarkets({ status: 'open', limit: 1000 }, { maxPages: 10 });
  console.log(`  ${markets.length} open markets returned`);

  const usedSeries = new Set();
  const kept = [];
  for (const m of markets) {
    if (m.mve_collection_ticker) continue; // multivariate combos are not single events
    const st = seriesTickerOf(m);
    const meta = seriesMetaMap.get(st) ?? {};
    const match = classifyMarket(m, { seriesTicker: st, ...meta });
    if (!match || !TOPIC_IDS.has(match.topicId)) continue;
    usedSeries.add(st);
    kept.push(m);
  }
  console.log(`  ${kept.length} markets in the five topics (series: ${[...usedSeries].join(', ') || 'none'})`);

  if (!kept.length) {
    console.warn('No in-scope markets found — refusing to overwrite an existing snapshot with an empty one.');
    process.exit(1);
  }

  const snapshot = {
    capturedAt: new Date().toISOString(),
    environment: 'demo',
    note:
      'Real values read from the Kalshi demo Trade API at capture time. Used only when the live API cannot be reached, and always labelled "snapshot" in the UI. No value here is invented.',
    sources: [
      'https://external-api.demo.kalshi.co/trade-api/v2/exchange/status',
      ...[...usedSeries].map(
        (st) => `https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=${encodeURIComponent(st)}&status=open`,
      ),
    ],
    series: Object.fromEntries([...usedSeries].map((st) => [st, seriesMetaMap.get(st)])),
    markets: kept,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, outPath);
  console.log(`wrote ${outPath} (${kept.length} markets, ${usedSeries.size} series, captured ${snapshot.capturedAt})`);
}

main().catch((err) => {
  console.error(`snapshot capture failed: ${err.message}`);
  process.exit(1);
});

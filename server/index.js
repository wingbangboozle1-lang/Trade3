/**
 * Zero-dependency HTTP server for the Kalshi demo dashboard.
 *
 * Routes:
 *   GET /api/state                 full dashboard snapshot
 *   GET /api/topics                topic views with markets
 *   GET /api/alerts?feed=all|model alert feeds
 *   GET /api/market/:ticker        one market incl. price history + book
 *   GET /api/chart/:ticker?window=seconds|minutes|hours
 *   GET /api/resolutions           resolved events (yes/no) while tracked
 *   GET /api/portfolio             simulated portfolio + Kalshi demo account (if keyed)
 *   GET /api/health                liveness + data mode + docs links
 *   GET /api/stream                Server-Sent Events (live push)
 *   static                         /app (dashboard), /docs (published site)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector, publicMarket } from './collector.js';
import { TOPICS } from './topics.js';
import { KalshiError } from './kalshi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function createServer({
  collector,
  staticRoots = [
    { prefix: '/app', dir: path.join(ROOT, 'app') },
    // This build's published site: /site/
    { prefix: '/site', dir: path.join(ROOT, 'docs', 'dashboard-site') },
    // The rest of the repository's site (Build A)
    { prefix: '/', dir: path.join(ROOT, 'docs') },
  ],
  logger = console,
} = {}) {
  const sseClients = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi({ req, res, url, collector, sseClients, logger });
        return;
      }
      serveStatic({ res, url, staticRoots, logger });
    } catch (err) {
      logger.error?.(`request failed ${req.method} ${req.url}: ${err.message}`);
      sendJson(res, 500, { error: { message: err.message } });
    }
  });

  collector.on('update', (payload) => broadcast(sseClients, { event: 'update', data: payload }));
  collector.on('alert', (alert) => broadcast(sseClients, { event: 'alert', data: alert }));
  collector.on('trade', (trade) => broadcast(sseClients, { event: 'trade', data: trade }));

  server.on('close', () => {
    for (const res of sseClients) res.end();
    sseClients.clear();
  });

  return server;
}

async function handleApi({ req, res, url, collector, sseClients, logger }) {
  const p = url.pathname.replace(/^\/api/, '');

  if (p === '/health') {
    return sendJson(res, 200, {
      ok: true,
      dataMode: collector.status.dataMode,
      effectiveMode: collector.effectiveMode,
      requestedMode: collector.requestedMode,
      lastPollAt: collector.status.lastPollAt,
      lastPollMs: collector.status.lastPollMs,
      consecutiveErrors: collector.status.consecutiveErrors,
      trackedMarkets: collector.markets.size,
      exchangeActive: collector.status.exchangeActive,
      notes: collector.status.notes,
      docs: [
        'https://docs.kalshi.com/getting_started/demo_env',
        'https://docs.kalshi.com/getting_started/api_environments',
        'https://docs.kalshi.com/api-reference/market/get-markets',
        'https://docs.kalshi.com/getting_started/orderbook_responses',
      ],
    });
  }

  if (p === '/state') return sendJson(res, 200, collector.state());

  if (p === '/topics') {
    return sendJson(res, 200, { topics: collector.topicView(), threshold: 0.1 });
  }

  if (p === '/alerts') {
    const feed = url.searchParams.get('feed') === 'model' ? collector.modelAlerts : collector.alerts;
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
    return sendJson(res, 200, { feed: url.searchParams.get('feed') === 'model' ? 'model' : 'all', alerts: feed.slice(0, limit) });
  }

  if (p === '/resolutions') {
    const topic = url.searchParams.get('topic');
    const list = topic ? collector.resolutions.filter((r) => r.topicId === topic) : collector.resolutions;
    return sendJson(res, 200, { resolutions: list });
  }

  if (p.startsWith('/market/')) {
    const ticker = decodeURIComponent(p.slice('/market/'.length));
    const m = collector.markets.get(ticker);
    if (!m) return sendJson(res, 404, { error: { message: `unknown ticker ${ticker}` } });
    return sendJson(res, 200, { market: publicMarket(m), history: m.history });
  }

  if (p.startsWith('/chart/')) {
    const ticker = decodeURIComponent(p.slice('/chart/'.length));
    const m = collector.markets.get(ticker);
    if (!m) return sendJson(res, 404, { error: { message: `unknown ticker ${ticker}` } });
    const windowId = url.searchParams.get('window') || 'minutes';
    return sendJson(res, 200, buildChart(m, windowId));
  }

  if (p === '/portfolio') {
    const state = collector.state();
    let kalshiAccount = null;
    try {
      kalshiAccount = await readKalshiAccount(collector);
    } catch (err) {
      kalshiAccount = {
        available: false,
        reason: err instanceof KalshiError ? `${err.code}: ${err.message}` : err.message,
      };
    }
    return sendJson(res, 200, { ...state.portfolio, kalshiDemoAccount: kalshiAccount });
  }

  if (p === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ dataMode: collector.status.dataMode, at: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
    return;
  }

  return sendJson(res, 404, { error: { message: `no such API route: ${url.pathname}` } });
}

/** Read the real Kalshi demo account when credentials are configured. */
async function readKalshiAccount(collector) {
  if (!collector.client.authenticated) {
    return {
      available: false,
      reason: 'No API key configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH to read the demo account.',
    };
  }
  const balance = await collector.client.balance();
  const positions = await collector.client.positions({ settlementStatus: 'all', limit: 200 });
  return {
    available: true,
    readAt: new Date().toISOString(),
    balance,
    positions,
    docs: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
  };
}

/** Chart payload for one market window. Windows map to the documented periods. */
export function buildChart(market, windowId) {
  const WINDOWS = {
    seconds: { ms: 5 * 60 * 1000, bucketMs: 5000, label: 'Last 5 minutes (5s buckets)' },
    minutes: { ms: 6 * 60 * 60 * 1000, bucketMs: 60 * 1000, label: 'Last 6 hours (1m buckets)' },
    hours: { ms: 7 * 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000, label: 'Last 7 days (1h buckets)' },
  };
  const win = WINDOWS[windowId] ?? WINDOWS.minutes;
  const now = Date.now();
  const points = [];
  if (market.history?.length) {
    for (const point of market.history) {
      if (now - point.t > win.ms) continue;
      const bucket = Math.floor(point.t / win.bucketMs) * win.bucketMs;
      const last = points[points.length - 1];
      if (last && last.t === bucket) last.p = point.p;
      else points.push({ t: bucket, p: point.p });
    }
  }
  // Seed the left edge from Kalshi's own documented "a day ago" price so the
  // hours window has a real reference point even right after startup.
  const seeded = [];
  if (Number.isFinite(market.previousPrice) && market.previousPrice > 0) {
    const dayAgo = now - 24 * 60 * 60 * 1000;
    if (now - dayAgo <= win.ms) {
      seeded.push({ t: Math.floor(dayAgo / win.bucketMs) * win.bucketMs, p: market.previousPrice, seed: 'previous_price_dollars' });
    }
  }
  const series = [...seeded, ...points].sort((a, b) => a.t - b.t);
  return {
    ticker: market.ticker,
    window: windowId,
    label: win.label,
    bucketMs: win.bucketMs,
    // Never let a chart claim to be live when the collector is in snapshot/demo mode.
    dataMode: market.history?.length ? (market.dataMode ?? 'live') : 'no-samples',
    series,
    current: market.price,
    previousPrice: market.previousPrice ?? null,
    book: market.book,
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    spread: market.spread,
    liquidity: { contracts: market.liquidityContracts, dollars: market.liquidityDollars },
    note:
      'History is built from this collector\'s own observations of the Kalshi demo API. ' +
      'For official historical candles use GET /series/{series_ticker}/markets/{ticker}/candlesticks.',
    officialCandlesUrl:
      `https://external-api.demo.kalshi.co/trade-api/v2/series/${encodeURIComponent(market.seriesTicker)}` +
      `/markets/${encodeURIComponent(market.ticker)}/candlesticks`,
  };
}

function broadcast(clients, { event, data }) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function serveStatic({ res, url, staticRoots, logger }) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  for (const root of staticRoots) {
    if (root.prefix !== '/' && !pathname.startsWith(root.prefix)) continue;
    const rel = root.prefix === '/' ? pathname : pathname.slice(root.prefix.length) || '/';
    const filePath = path.join(root.dir, rel);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(root.dir))) continue; // path traversal guard
    const target = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? path.join(resolved, 'index.html')
      : resolved;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      const ext = path.extname(target).toLowerCase();
      const body = fs.readFileSync(target);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(body);
      return;
    }
  }
  const notFound = path.join(ROOT, 'docs', '404.html');
  if (fs.existsSync(notFound)) {
    const body = fs.readFileSync(notFound);
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': body.length });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': MIME['.html'] });
  res.end('<h1>404</h1><p>Not found. <a href="/">Dashboard</a></p>');
}

// ---- main ------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const ENV = process.env.KALSHI_ENV || 'demo';
  const POLL_MS = Number(process.env.POLL_INTERVAL_MS) || 15000;
  const TRACKED_PER_TOPIC = Number(process.env.TRACKED_PER_TOPIC) || 12;
  // DATA_MODE: 'live' (default) | 'snapshot' (committed real capture) | 'demo' (synthetic).
  const DATA_MODE = (process.env.DATA_MODE || 'live').toLowerCase();
  const ALLOW_DEMO_FALLBACK = process.env.ALLOW_DEMO_FALLBACK !== '0';

  const collector = new Collector({
    env: ENV,
    pollIntervalMs: POLL_MS,
    trackedPerTopic: TRACKED_PER_TOPIC,
    dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
    dataMode: DATA_MODE,
    allowDemoFallback: ALLOW_DEMO_FALLBACK,
  });

  const server = createServer({ collector });
  server.listen(PORT, HOST, () => {
    console.log(`Kalshi dashboard: http://${HOST}:${PORT}/app/   (env=${ENV}, poll=${POLL_MS}ms, dataMode=${DATA_MODE})`);
    console.log(`This build's site: http://${HOST}:${PORT}/site/`);
    console.log(`Repository site:   http://${HOST}:${PORT}/`);
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (collector.effectiveMode === 'live') await collector.refreshSeriesCategories().catch(() => {});
      await collector.pollOnce();
      if (collector.effectiveMode === 'live') await collector.refreshResolutions().catch(() => {});
      collector.managePositions();
    } catch {
      /* logged inside collector */
    } finally {
      running = false;
    }
  };

  tick();
  const pollTimer = setInterval(tick, POLL_MS);

  const shutdown = () => {
    clearInterval(pollTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

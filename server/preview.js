#!/usr/bin/env node
/**
 * Live preview server — the build that can be genuinely live.
 *
 * Why this exists
 * ---------------
 * The static GitHub Pages build (`docs/`) can only reach Kalshi if the visitor's
 * browser is allowed to call the API cross-origin. Whether Kalshi sends CORS headers
 * could not be established from the build sandbox (flag F6), and no CORS probe can be
 * run here at all. So the reliable live path is a server: it reads Kalshi from Node,
 * where no CORS rule applies, and serves the dashboard and the published site from the
 * same origin.
 *
 * Credentials, read from the environment only — never from a file in the repo:
 *
 *   KALSHI_API_KEY_ID            demo API key id (optional for public market data)
 *   KALSHI_PRIVATE_KEY_PEM       the private key material itself (PEM), or
 *   KALSHI_PRIVATE_KEY_PATH      a path to a PEM file on the machine
 *   KALSHI_ALLOW_ORDERS=1        required before anything is ever sent to the order endpoint
 *
 * With a key, `/api/portfolio` additionally reads the real demo portfolio
 * (`GET /portfolio/balance` and `GET /portfolio/positions`). Without one, the dashboard
 * still shows live public market data and says plainly that the account is unread.
 *
 * Usage:
 *   npm start                         live demo data, snapshot fallback disabled
 *   DATA_MODE=snapshot npm start      replay the committed capture (labelled)
 *   DATA_MODE=demo npm start          synthetic data (labelled)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector } from './collector.js';
import { KalshiClient, loadPrivateKey } from './kalshi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Human-readable credential state — never includes key material. */
export function credentialState(env = process.env) {
  const keyId = env.KALSHI_API_KEY_ID || '';
  const pem = env.KALSHI_PRIVATE_KEY_PEM || '';
  const keyPath = env.KALSHI_PRIVATE_KEY_PATH || '';
  let keyError = null;
  if (pem || keyPath) {
    try {
      loadPrivateKey({ pem, path: keyPath });
    } catch (err) {
      keyError = err.message;
    }
  }
  return {
    keyIdPresent: Boolean(keyId),
    keyMaterialPresent: Boolean(pem || keyPath),
    keySource: pem ? 'KALSHI_PRIVATE_KEY_PEM' : keyPath ? 'KALSHI_PRIVATE_KEY_PATH' : null,
    keyError,
    authenticated: Boolean(keyId && (pem || keyPath) && !keyError),
    ordersAllowed: env.KALSHI_ALLOW_ORDERS === '1',
  };
}

/** Build the collector with credentials taken from the environment. */
export function makeCollector({ env = process.env, logger = console } = {}) {
  const kalshiEnv = env.KALSHI_ENV || 'demo';
  const creds = credentialState(env);
  const client = new KalshiClient({
    env: kalshiEnv,
    keyId: env.KALSHI_API_KEY_ID || '',
    privateKey: creds.authenticated
      ? loadPrivateKey({ pem: env.KALSHI_PRIVATE_KEY_PEM, path: env.KALSHI_PRIVATE_KEY_PATH })
      : null,
    onLog: (lvl, msg) => (logger[lvl] || logger.info)?.call(logger, msg),
  });
  const collector = new Collector({
    env: kalshiEnv,
    client,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS) || 15000,
    trackedPerTopic: Number(env.TRACKED_PER_TOPIC) || 12,
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    dataMode: (env.DATA_MODE || 'live').toLowerCase(),
    allowDemoFallback: env.ALLOW_DEMO_FALLBACK !== '0',
  });
  collector.credentials = creds;
  return collector;
}

export function createLiveServer({ collector, logger = console } = {}) {
  const roots = [
    { prefix: '/app', dir: path.join(ROOT, 'app') },
    { prefix: '/audit', dir: path.join(ROOT, 'docs', 'dashboard-site') },
    { prefix: '/', dir: path.join(ROOT, 'docs') },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      handleApi({ req, res, url, collector }).catch((err) => {
        logger.error?.(`api failed ${url.pathname}: ${err.message}`);
        sendJson(res, 500, { error: { message: err.message } });
      });
      return;
    }
    serveStatic({ res, url, roots });
  });
  return server;
}

async function handleApi({ req, res, url, collector }) {
  const p = url.pathname.replace(/^\/api/, '');
  if (p === '/health') {
    return sendJson(res, 200, {
      ok: true,
      dataMode: collector.status.dataMode,
      effectiveMode: collector.effectiveMode,
      requestedMode: collector.requestedMode,
      lastPollAt: collector.status.lastPollAt,
      trackedMarkets: collector.markets.size,
      exchangeActive: collector.status.exchangeActive,
      credentials: collector.credentials ?? credentialState(),
      notes: collector.status.notes,
    });
  }
  if (p === '/state') return sendJson(res, 200, collector.state());
  if (p === '/topics') return sendJson(res, 200, { topics: collector.topicView(), threshold: 0.1 });
  if (p === '/alerts') {
    const feed = url.searchParams.get('feed') === 'model' ? collector.modelAlerts : collector.alerts;
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
    return sendJson(res, 200, { feed: url.searchParams.get('feed') === 'model' ? 'model' : 'all', alerts: feed.slice(0, limit) });
  }
  if (p === '/resolutions') return sendJson(res, 200, { resolutions: collector.resolutions });
  if (p === '/portfolio') {
    const state = collector.state();
    let account;
    try {
      if (!collector.client.authenticated) {
        account = { available: false, reason: 'No API key configured (KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PEM/PATH).' };
      } else {
        const [balance, positions] = await Promise.all([
          collector.client.balance(),
          collector.client.positions({ settlementStatus: 'all', limit: 200 }),
        ]);
        account = { available: true, readAt: new Date().toISOString(), balance, positions };
      }
    } catch (err) {
      account = { available: false, reason: err.message };
    }
    return sendJson(res, 200, { ...state.portfolio, kalshiDemoAccount: account });
  }
  if (p === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const clients = serverClients.get(collector) ?? new Set();
    serverClients.set(collector, clients);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  return sendJson(res, 404, { error: { message: `no such API route: ${url.pathname}` } });
}

const serverClients = new WeakMap();

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function serveStatic({ res, url, roots }) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  for (const root of roots) {
    if (root.prefix !== '/' && !pathname.startsWith(root.prefix)) continue;
    const rel = root.prefix === '/' ? pathname : pathname.slice(root.prefix.length) || '/';
    const target = path.resolve(path.join(root.dir, rel));
    if (!target.startsWith(path.resolve(root.dir))) continue;
    const file = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': body.length });
      res.end(body);
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': MIME['.html'] });
  res.end('<h1>404</h1><p>Not found. <a href="/">Dashboard</a></p>');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const collector = makeCollector();
  const server = createLiveServer({ collector });
  const clients = new Set();
  serverClients.set(collector, clients);
  collector.on('alert', (a) => broadcast(clients, 'alert', a));
  collector.on('update', (d) => broadcast(clients, 'update', d));

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (collector.effectiveMode === 'live') await collector.refreshSeriesCategories().catch(() => {});
      await collector.pollOnce();
      if (collector.effectiveMode === 'live') await collector.refreshResolutions().catch(() => {});
      collector.managePositions();
    } catch { /* logged inside the collector */ } finally { running = false; }
  };

  server.listen(PORT, HOST, () => {
    const creds = collector.credentials;
    console.log(`dashboard  http://${HOST}:${PORT}/app/`);
    console.log(`site       http://${HOST}:${PORT}/`);
    console.log(`mode       ${collector.requestedMode} (live poll needs egress to the Kalshi hosts)`);
    console.log(`credential ${creds.authenticated ? `configured (${creds.keySource})` : 'none — public market data only; the demo portfolio cannot be read'}`);
  });
  tick();
  setInterval(tick, Number(process.env.POLL_INTERVAL_MS) || 15000).unref();
}

function broadcast(clients, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }
}

// HTTP + WebSocket server for the live dashboard.
//
// Two jobs:
//  1. Serve the dashboard (app/public) and a JSON API.
//  2. Push events to the browser over a WebSocket. The browser never talks to
//     Kalshi directly: our server holds the private key, and Kalshi's REST hosts do
//     not send permissive CORS headers, so a direct browser call would fail anyway.
//
// Endpoints
//   GET /api/status                 engine + feed + broker status, provenance
//   GET /api/topics                 topic definitions (from research/topics.json)
//   GET /api/events?topic=&limit=   highest dollar-volume live events
//   GET /api/topic/:id              events grouped by event, markets nested
//   GET /api/market/:ticker         market detail incl. book + points
//   GET /api/alerts?filter=all|highroi&limit=
//   GET /api/resolutions
//   GET /api/portfolio             paper + live + reconciliation
//   GET /api/analytics             categorized trade results
//   GET /api/strategies            strategy definitions with measured stats
//   GET /api/sources               research source registry
//   POST /api/orders               place a real demo order (guarded, opt-in)
//   DELETE /api/orders/:id         cancel a real demo order
//
// Zero dependencies: node:http + node:crypto only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, hasCredentials, ROOT } from './config.mjs';
import { IngestEngine, provenance } from './lib/ingest.mjs';
import { strategyList, STRATEGIES } from './lib/strategy.mjs';
import { fmtPrice, ticksToDollars, WINDOWS } from './lib/util.mjs';
import { keyLoadWarning } from './lib/rest.mjs';
import { SERIES_FEE_MULTIPLIERS, multiplierForSeries } from './lib/fees.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const PUBLIC_DIR = path.join(ROOT, 'app', 'public');

/* --------------------------------------------------------------- WS plumbing */
class Broadcaster {
  constructor() {
    this.clients = new Set();
    this.seq = 0;
  }

  add(socket) {
    this.clients.add(socket);
  }

  remove(socket) {
    this.clients.delete(socket);
  }

  send(socket, event, payload) {
    if (socket.destroyed) return;
    const json = JSON.stringify({ type: event, ...payload });
    const frame = encodeFrame(json);
    if (frame) socket.write(frame);
  }

  broadcast(event, payload) {
    if (!this.clients.size) return;
    const json = JSON.stringify({ type: event, ...payload });
    const frame = encodeFrame(json);
    if (!frame) return;
    for (const s of this.clients) {
      if (s.destroyed) {
        this.clients.delete(s);
        continue;
      }
      s.write(frame);
    }
  }
}

/** Minimal RFC6455 frame encoder for server->client text frames. */
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text
  return Buffer.concat([header, payload]);
}

/* ------------------------------------------------------------------ helpers */
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60'
    });
    res.end(data);
  });
}

/* ---------------------------------------------------------------- page views */
function serializeAlert(a) {
  return {
    id: a.id,
    kind: a.kind,
    ticker: a.ticker,
    eventTicker: a.eventTicker,
    eventTitle: a.eventTitle,
    marketTitle: a.marketTitle,
    topic: a.topic,
    topicReason: a.topicReason,
    direction: a.direction,
    from: fmtPrice(a.fromTicks),
    to: fmtPrice(a.toTicks),
    delta: `${a.deltaTicks > 0 ? '+' : '-'}$${(Math.abs(a.deltaTicks) / 1_000_000).toFixed(2)}`,
    deltaCents: Math.round(a.deltaTicks / 10_000),
    fromTs: a.fromTs,
    toTs: a.toTs,
    windowMs: a.windowMs,
    source: a.source,
    highRoi: a.highRoi,
    score: a.score
      ? {
          promote: a.score.promote,
          score: a.score.score,
          bestEvTicks: a.score.bestEvTicks,
          returnBps: a.score.returnBps,
          contracts: a.score.contracts,
          maker: a.score.maker,
          taker: a.score.taker,
          coherence: a.score.coherence,
          reasons: a.score.reasons,
          gates: a.score.gates,
          inputs: a.score.inputs
        }
      : null,
    siblings: a.siblings || null,
    causes: a.causes || [],
    chart: a.chart || []
  };
}

/**
 * Turn engine state into page-shaped rows. Every row that represents a claim about
 * Kalshi carries `sourceIds`; the static site build checks that these exist.
 */
function buildRow(m, extra = {}) {
  return {
    ticker: m.ticker,
    event: m.eventTicker,
    market: m.subtitle || m.title,
    topic: m.topic,
    yesBid: fmtPrice(m.yesBidTicks),
    yesAsk: fmtPrice(m.yesAskTicks),
    last: fmtPrice(m.lastTicks),
    spread:
      m.yesBidTicks !== null && m.yesAskTicks !== null ? `${((m.yesAskTicks - m.yesBidTicks) / 10_000).toFixed(1)}c` : '—',
    depthYes: m.book ? m.book.yesContracts : null,
    depthNo: m.book ? m.book.noContracts : null,
    volume: m.volumeContracts,
    openInterest: m.openInterestContracts,
    liquidity: m.liquidityTicks,
    closesSec: m.closeSec,
    result: m.result || '',
    settlement: m.settlementValueTicks,
    status: m.status,
    ...extra
  };
}

/* ------------------------------------------------------------------- server */
export async function createServer({ cfg = config, engine = null } = {}) {
  const ing = engine ?? new IngestEngine({ cfg });
  const bus = new Broadcaster();
  let started = false;

  // Wire engine events into the browser bus.
  ing.on('alert', (a) => bus.broadcast('alert', { alert: serializeAlert(a) }));
  ing.on('resolution', (r) => bus.broadcast('resolution', { resolution: r }));
  ing.on('paperTrade', (t) => bus.broadcast('paperTrade', { trade: t }));
  ing.on('paperOpen', (p) => bus.broadcast('paperOpen', { position: p }));
  ing.on('mode', (m) => bus.broadcast('mode', m));
  ing.on('ws', (s) => bus.broadcast('feed', { feed: s }));
  ing.on('discovery', (d) => bus.broadcast('discovery', { discovery: d }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }

    try {
      // ---- WebSocket upgrade is handled below; here: plain HTTP -------------
      if (p === '/api/status') {
        return json(res, 200, {
          ...ing.status(),
          provenance: provenance(ing.mode),
          keyWarning: keyLoadWarning(),
          windows: WINDOWS,
          dataDir: cfg.dataDir
        });
      }

      if (p === '/api/topics') {
        return json(res, 200, {
          topics: Object.entries(cfg.topics.topics).map(([id, t]) => ({
            id,
            name: t.name,
            blurb: t.blurb,
            color: t.color,
            rules: t.rules,
            seeds: t.seed_series,
            newsFeeds: t.news_feeds
          })),
          thresholds: cfg.topics.thresholds
        });
      }

      if (p === '/api/events') {
        const topic = url.searchParams.get('topic');
        const limit = Math.min(Number(url.searchParams.get('limit') || 25), 100);
        return json(res, 200, { events: ing.index.rankEvents({ limit, topic }) });
      }

      if (p.startsWith('/api/topic/')) {
        const id = decodeURIComponent(p.replace('/api/topic/', ''));
        const view = ing.topicView(id);
        if (!view.topic) return json(res, 404, { error: 'unknown topic', id });
        return json(res, 200, {
          topic: { id, name: view.topic.name, blurb: view.topic.blurb, color: view.topic.color },
          events: view.events.map((ev) => ({
            ...ev,
            rows: ev.markets.map((m) => buildRow(m))
          }))
        });
      }

      if (p.startsWith('/api/market/')) {
        const ticker = decodeURIComponent(p.replace('/api/market/', ''));
        const m = ing.index.get(ticker);
        if (!m) return json(res, 404, { error: 'unknown market', ticker });
        return json(res, 200, { market: ing.marketView(m), row: buildRow(m) });
      }

      if (p === '/api/alerts') {
        const filter = url.searchParams.get('filter') || 'all';
        const limit = Math.min(Number(url.searchParams.get('limit') || 150), 500);
        const list = ing.alerts.recent(limit, filter === 'highroi' ? (a) => a.highRoi : null);
        return json(res, 200, { alerts: list.map(serializeAlert), filter });
      }

      if (p === '/api/resolutions') {
        return json(res, 200, { resolutions: ing.resolutions });
      }

      if (p === '/api/portfolio') {
        return json(res, 200, ing.analytics());
      }

      if (p === '/api/analytics') {
        return json(res, 200, ing.analytics());
      }

      if (p === '/api/strategies') {
        const analysis = ing.analytics();
        const measured = analysis.byStrategy || {};
        return json(res, 200, {
          strategies: strategyList().map((s) => ({
            ...s,
            measured: measured[s.id] || { n: 0 },
            ranked: (analysis.rankings || []).find((r) => r.id === s.id) || null
          })),
          adverseSelection: ing.paper.adverseSelection(),
          feeMultipliers: SERIES_FEE_MULTIPLIERS
        });
      }

      if (p === '/api/fees') {
        const ticker = url.searchParams.get('ticker') || '';
        const series = url.searchParams.get('series') || '';
        const price = url.searchParams.get('price');
        const count = Number(url.searchParams.get('count') || 1);
        const mult = multiplierForSeries(series || ticker.split('-')[0]);
        return json(res, 200, {
          series: series || ticker.split('-')[0],
          multiplier: mult,
          priceDollars: price,
          count,
          formulas: {
            taker: 'fees = roundup(M x 0.07 x C x P x (1-P))',
            maker: 'fees = roundup(M x 0.0175 x C x P x (1-P))',
            rounding: 'round up to a centicent ($0.0001) per the schedule text; see flag F11',
            settlement: 'no settlement fee'
          },
          sourceIds: ['K6', 'K7']
        });
      }

      if (p === '/api/sources') {
        const file = path.join(ROOT, 'research', 'sources.json');
        const raw = fs.readFileSync(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(raw);
      }

      if (p === '/api/orders' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.confirm !== 'PLACE_DEMO_ORDER') {
          return json(res, 400, {
            error: 'confirmation_required',
            message: 'POST /api/orders requires {"confirm":"PLACE_DEMO_ORDER"} so an automated caller cannot place orders by accident.'
          });
        }
        const result = await ing.broker.placeOrder({
          ticker: body.ticker,
          side: body.side,
          contracts: Number(body.contracts),
          priceTicks: Math.round(Number(body.priceDollars) * 1_000_000),
          timeInForce: body.timeInForce || 'good_till_canceled',
          clientOrderId: body.clientOrderId,
          reason: body.reason || 'manual api'
        });
        return json(res, result.ok ? 201 : 400, result);
      }

      if (p.startsWith('/api/orders/') && req.method === 'DELETE') {
        const id = decodeURIComponent(p.replace('/api/orders/', ''));
        const result = await ing.broker.cancelOrder(id, url.searchParams.get('ticker') || undefined);
        return json(res, result.ok ? 200 : 400, result);
      }

      if (p === '/healthz') {
        return json(res, 200, { ok: true, mode: ing.mode, uptimeMs: Date.now() - (ing.startedAt || Date.now()) });
      }

      if (p.startsWith('/api/')) {
        return json(res, 404, { error: 'unknown endpoint', path: p });
      }

      return serveStatic(req, res, p);
    } catch (err) {
      return json(res, 500, { error: 'internal', message: err.message });
    }
  });

  // ---- WebSocket upgrade --------------------------------------------------
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    bus.add(socket);
    socket.on('close', () => bus.remove(socket));
    socket.on('error', () => bus.remove(socket));
    socket.on('data', (buf) => {
      // Only handle close/ping from the client; the dashboard does not send commands.
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) {
        bus.remove(socket);
        socket.end();
      } else if (opcode === 0x9) {
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
      }
    });
    // Send a snapshot immediately so a fresh tab is not blank.
    bus.send(socket, 'hello', {
      mode: ing.mode,
      provenance: provenance(ing.mode),
      topics: Object.keys(cfg.topics.topics),
      alerts: ing.alerts.recent(60).map(serializeAlert),
      resolutions: ing.resolutions.slice(0, 40),
      status: ing.status()
    });
    const ping = setInterval(() => {
      if (socket.destroyed) {
        clearInterval(ping);
        return;
      }
      socket.write(Buffer.from([0x89, 0x00]));
    }, 25_000);
    socket.on('close', () => clearInterval(ping));
  });

  return {
    server,
    engine: ing,
    bus,
    async listen() {
      if (!started) {
        started = true;
        await ing.start();
      }
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, () => resolve());
      });
      return server.address();
    },
    async close() {
      ing.stop();
      await new Promise((r) => server.close(r));
    }
  };
}

// Allow `node app/server.mjs` as well as importing createServer.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const app = await createServer();
  const addr = await app.listen();
  const shown = typeof addr === 'object' ? `${addr.address}:${addr.port}` : String(addr);
  console.log(`[kalshi-dash] listening on http://${shown}  mode=${app.engine.mode}`);
  console.log(`[kalshi-dash] credentials: ${hasCredentials() ? 'present' : 'absent (market data only, no orders)'}`);
  const shutdown = async () => {
    console.log('\n[kalshi-dash] shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

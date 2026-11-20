// Runtime configuration. Defaults are the Kalshi *recommended* demo hosts (K1, K2).
//
// K1 https://docs.kalshi.com/getting_started/api_environments.md
//   Demo | recommended https://external-api.demo.kalshi.co/trade-api/v2
//        | also supported https://demo-api.kalshi.co/trade-api/v2
//   WS   | recommended wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2
//        | also supported wss://demo-api.kalshi.co/trade-api/ws/v2
// K2 https://docs.kalshi.com/getting_started/demo_env.md
//   "The price and behavior of markets in the demo environment may not be
//    reflective of those in real markets."

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const HOSTS = {
  rest: {
    recommended: 'https://external-api.demo.kalshi.co/trade-api/v2',
    alternate: 'https://demo-api.kalshi.co/trade-api/v2',
    production: 'https://external-api.kalshi.com/trade-api/v2'
  },
  ws: {
    recommended: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    alternate: 'wss://demo-api.kalshi.co/trade-api/ws/v2',
    production: 'wss://external-api-ws.kalshi.com/trade-api/ws/v2'
  }
};

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function loadTopics() {
  const file = path.join(ROOT, 'research', 'topics.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const topics = loadTopics();

export const config = {
  port: Number(env('PORT', 8787)),
  // Bind 0.0.0.0 so the sandbox proxy / preview can reach it.
  host: env('HOST', '0.0.0.0'),

  env: env('KALSHI_ENV', 'demo'),
  restBase: env('KALSHI_REST_BASE', HOSTS.rest.recommended),
  wsBase: env('KALSHI_WS_BASE', HOSTS.ws.recommended),
  // 'live' hits Kalshi; 'mock' runs the local doc-faithful exchange so the whole
  // app can be exercised with no network; 'auto' uses live when reachable.
  dataSource: env('DATA_SOURCE', 'auto'),

  keyId: env('KALSHI_KEY_ID', ''),
  privateKeyPath: env('KALSHI_PRIVATE_KEY_PATH', ''),
  privateKeyPem: env('KALSHI_PRIVATE_KEY_PEM', ''),

  // ---- alerting -----------------------------------------------------------
  alert: {
    moveDollars: Number(env('ALERT_MOVE_DOLLARS', topics.thresholds.alert_move_dollars)),
    // Debounce: after an alert for a market, require this gap before another alert
    // on the same market, so one fast leg does not spam the chat.
    cooldownMs: Number(env('ALERT_COOLDOWN_MS', 15_000)),
    // Compare against the price N seconds ago as well as the immediately preceding
    // print, so slow drift that adds up to 10c is still caught.
    driftWindowMs: Number(env('ALERT_DRIFT_WINDOW_MS', 300_000)),
    minLiquidityContracts: Number(env('ALERT_MIN_LIQUIDITY', 1))
  },

  model: {
    // Minimum expected edge per contract, after fees, that promotes a signal to the
    // "Model picks" chat. Default $0.005: a maker can realistically capture half of
    // a 1-2c spread, so requiring more than that would promote nothing.
    minEdge: Number(env('MODEL_MIN_EDGE', topics.thresholds.high_roi_min_edge)),
    minLiquidity: Number(env('MODEL_MIN_LIQUIDITY', topics.thresholds.high_roi_min_liquidity_contracts)),
    // Selectivity: minimum edge as a share of capital (bps), and how many times the
    // spread a move must be before it counts as signal rather than noise.
    minReturnBps: Number(env('MODEL_MIN_RETURN_BPS', 150)),
    minShockOverSpread: Number(env('MODEL_MIN_SHOCK_OVER_SPREAD', 2)),
    maxSpread: Number(env('MODEL_MAX_SPREAD', topics.thresholds.high_roi_max_spread_dollars)),
    maxMinutesToClose: Number(env('MODEL_MAX_MINUTES_TO_CLOSE', topics.thresholds.high_roi_max_minutes_to_close)),
    maxRiskPerTradeTicks: Math.round(Number(env('MODEL_MAX_RISK_DOLLARS', 50)) * 1_000_000),
    paperStartTicks: Math.round(Number(env('PAPER_START_DOLLARS', 10000)) * 1_000_000)
  },

  // ---- sampling -----------------------------------------------------------
  poll: {
    // REST fallbacks run on their own timers. Balance is capped at 1/s on the
    // Basic/Advanced tiers (K4), so never poll it faster than this.
    marketsMs: Number(env('POLL_MARKETS_MS', 30_000)),
    orderbookMs: Number(env('POLL_ORDERBOOK_MS', 20_000)),
    balanceMs: Number(env('POLL_BALANCE_MS', 5_000)),
    eventsMs: Number(env('POLL_EVENTS_MS', 120_000)),
    maxMarkets: Number(env('MAX_MARKETS', 120)),
    maxEvents: Number(env('MAX_EVENTS', 60))
  },

  // Ring buffer sizes. Bounded on purpose: the process must run for days.
  budget: {
    pricePointsPerMarket: Number(env('PRICE_POINTS_PER_MARKET', 4_000)),
    alertsKept: Number(env('ALERTS_KEPT', 5_000)),
    tradesKept: Number(env('TRADES_KEPT', 5_000))
  },

  dataDir: env('DATA_DIR', path.join(HERE, 'data')),
  topics,
  logLevel: env('LOG_LEVEL', 'info')
};

export function hasCredentials() {
  return Boolean(config.keyId && (config.privateKeyPem || config.privateKeyPath));
}

export function dataSourceMode() {
  if (config.dataSource === 'mock') return 'mock';
  if (config.dataSource === 'live') return 'live';
  return 'auto';
}

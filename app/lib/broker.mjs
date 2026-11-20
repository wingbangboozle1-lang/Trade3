// Broker: the ONLY place real Kalshi demo orders are sent.
//
// Contract, per the official reference:
//   create  POST   /portfolio/events/orders        K13   (V2; legacy path is 410)
//   cancel  DELETE /portfolio/events/orders/{id}   K14
//   balance GET    /portfolio/balance              K15
//   positions GET  /portfolio/positions            K16
//
// Guard rails baked in (all reversible through env, none silent):
//   * DEMO ONLY by default. Trading against production requires an explicit
//     KALSHI_ENV=prod plus KALSHI_ALLOW_PROD=1, because this is a test harness and
//     demo-tested strategies have no demonstrated edge in production (K2 warning).
//   * Max order count and max daily notional are enforced locally before a request
//     is sent, so a strategy bug cannot empty the account.
//   * Every request and response is appended to an audit log file so the user can
//     reconcile what the app did against the Kalshi dashboard.
//   * reduce_only is only ever set with immediate_or_cancel, which is the only
//     combination Kalshi accepts (K13).

import fs from 'node:fs';
import path from 'node:path';
import { config, hasCredentials } from '../config.mjs';
import { KalshiRest, KalshiError } from './rest.mjs';
import { ticksToDollars, dollarsToTicks, countToCents100 } from './util.mjs';

export class Broker {
  constructor({ rest = null, logger = console, dataDir = config.dataDir } = {}) {
    this.rest = rest ?? KalshiRest.fromEnv();
    this.logger = logger;
    this.dataDir = dataDir;
    this.auditFile = path.join(dataDir, 'broker-audit.jsonl');
    this.fs = fs;
    this.ordersSentToday = 0;
    this.notionalSentToday = 0;
    this.dayKey = new Date().toISOString().slice(0, 10);
    this.lastError = null;
    this.limits = {
      maxOrderCount: Number(process.env.KALSHI_MAX_ORDER_COUNT || 100),
      maxDailyNotionalTicks: Math.round(Number(process.env.KALSHI_MAX_DAILY_NOTIONAL || 500) * 1_000_000),
      allowProduction: process.env.KALSHI_ALLOW_PROD === '1'
    };
  }

  get connected() {
    return Boolean(this.rest && this.rest.authenticated);
  }

  get environment() {
    return config.env;
  }

  #audit(entry) {
    try {
      this.fs.mkdirSync(this.dataDir, { recursive: true });
      this.fs.appendFileSync(this.auditFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
    } catch (err) {
      this.logger.warn?.(`[broker] could not write audit log: ${err.message}`);
    }
  }

  #rollDay() {
    const k = new Date().toISOString().slice(0, 10);
    if (k !== this.dayKey) {
      this.dayKey = k;
      this.ordersSentToday = 0;
      this.notionalSentToday = 0;
    }
  }

  #assertEnvironment() {
    if (this.environment === 'prod' && !this.limits.allowProduction) {
      throw new KalshiError(
        'Refusing to trade in production: set KALSHI_ALLOW_PROD=1 if you really mean it. Demo prices are what this harness was tested against (K2).',
        { code: 'prod_blocked' }
      );
    }
  }

  async status() {
    if (!this.connected) {
      return { connected: false, environment: this.environment, reason: 'no_api_key' };
    }
    try {
      const bal = await this.rest.balance();
      return {
        connected: true,
        environment: this.environment,
        balanceTicks: dollarsToTicks(bal?.balance_dollars) ?? (bal?.balance != null ? bal.balance * 10_000 : null),
        portfolioValueTicks:
          bal?.portfolio_value != null ? Math.round((bal.portfolio_value / 100) * 1_000_000) : null,
        updatedTs: bal?.updated_ts ?? null,
        raw: bal
      };
    } catch (err) {
      this.lastError = { message: err.message, code: err.code, at: Date.now() };
      return { connected: false, environment: this.environment, reason: err.code || 'error', message: err.message };
    }
  }

  async balance() {
    return this.rest.balance();
  }

  /** Positions, normalized to integer ticks. position_fp is signed: + YES, - NO (K16). */
  async positions() {
    const res = await this.rest.positions({ countFilter: 'position', settlementStatus: 'all' });
    const rows = (res?.market_positions ?? []).map((p) => {
      const signed = countToCents100(p.position_fp) ?? 0;
      return {
        ticker: p.ticker,
        contracts: Math.round(Math.abs(signed) / 100),
        side: signed > 0 ? 'yes' : signed < 0 ? 'no' : 'flat',
        exposureTicks: dollarsToTicks(p.market_exposure_dollars),
        realizedPnlTicks: dollarsToTicks(p.realized_pnl_dollars),
        feesPaidTicks: dollarsToTicks(p.fees_paid_dollars),
        totalTradedTicks: dollarsToTicks(p.total_traded_dollars),
        lastUpdatedTs: p.last_updated_ts,
        raw: p
      };
    });
    return { rows, cursor: res?.cursor ?? '', raw: res };
  }

  /**
   * Place a real demo order. Returns { ok, order } or { ok:false, error }.
   * `side` is Kalshi book vocabulary: bid = buy YES, ask = sell YES (K13/K17).
   */
  async placeOrder({ ticker, side, contracts, priceTicks, timeInForce = 'good_till_canceled', clientOrderId, reason = '' }) {
    this.#rollDay();
    this.#assertEnvironment();
    if (!this.connected) {
      return { ok: false, error: { code: 'no_api_key', message: 'No Kalshi demo API key configured (K3)' } };
    }
    if (!['bid', 'ask'].includes(side)) {
      return { ok: false, error: { code: 'bad_side', message: 'side must be bid|ask (K13)' } };
    }
    if (!(contracts > 0) || contracts > this.limits.maxOrderCount) {
      return {
        ok: false,
        error: { code: 'count_limit', message: `contracts ${contracts} outside (0, ${this.limits.maxOrderCount}]` }
      };
    }
    const notional = Math.round(contracts * priceTicks);
    if (this.notionalSentToday + notional > this.limits.maxDailyNotionalTicks) {
      return {
        ok: false,
        error: { code: 'daily_notional_limit', message: 'local daily notional cap reached' }
      };
    }

    const body = {
      ticker,
      side,
      count: (contracts).toFixed(2),
      price: ticksToDollars(priceTicks, 4),
      timeInForce,
      clientOrderId
    };
    this.#audit({ kind: 'order_request', body, reason });
    try {
      const res = await this.rest.createOrder(body);
      this.ordersSentToday += 1;
      this.notionalSentToday += notional;
      this.#audit({ kind: 'order_response', body, res });
      // K13: 201 means accepted, not resting. fill_count/remaining_count tell the truth.
      const filled = countToCents100(res?.fill_count) ?? 0;
      const remaining = countToCents100(res?.remaining_count) ?? 0;
      return {
        ok: true,
        order: {
          orderId: res?.order_id ?? null,
          clientOrderId: res?.client_order_id ?? clientOrderId ?? null,
          filledContracts: Math.round(filled / 100),
          remainingContracts: Math.round(remaining / 100),
          tsMs: res?.ts_ms ?? null,
          resting: remaining > 0,
          raw: res
        }
      };
    } catch (err) {
      this.lastError = { message: err.message, code: err.code, at: Date.now() };
      this.#audit({ kind: 'order_error', body, error: { message: err.message, code: err.code, status: err.status } });
      return { ok: false, error: { code: err.code || 'error', message: err.message } };
    }
  }

  async cancelOrder(orderId, marketTicker) {
    this.#assertEnvironment();
    this.#audit({ kind: 'cancel_request', orderId, marketTicker });
    try {
      const res = await this.rest.cancelOrder(orderId, marketTicker);
      this.#audit({ kind: 'cancel_response', orderId, res });
      return { ok: true, order: res };
    } catch (err) {
      this.#audit({ kind: 'cancel_error', orderId, error: { message: err.message, code: err.code } });
      return { ok: false, error: { code: err.code || 'error', message: err.message } };
    }
  }

  statusSummary() {
    return {
      connected: this.connected,
      environment: this.environment,
      restBase: this.rest?.baseUrl ?? null,
      authenticated: this.rest?.authenticated ?? false,
      credentialsPresent: hasCredentials(),
      ordersSentToday: this.ordersSentToday,
      notionalSentTodayTicks: this.notionalSentToday,
      limits: this.limits,
      lastError: this.lastError,
      auditFile: this.auditFile
    };
  }
}

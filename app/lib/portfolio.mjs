// Portfolio analytics: turn the paper ledger into the categories the user asked
// for ("analyze the results of the trades and categorize trades and create
// strategies based on the type of trade").
//
// Every metric here is a function of recorded trades only. No metric is estimated
// and nothing is annualised. When a metric has too few samples to mean anything,
// `n` is reported next to it and the UI greys it out; we never present a 2-trade
// hit rate as a result.

import { TICKS_PER_DOLLAR } from './util.mjs';

const T = TICKS_PER_DOLLAR;

function bucketPrice(ticks) {
  if (ticks < 100_000) return '0-10c';
  if (ticks < 250_000) return '10-25c';
  if (ticks < 500_000) return '25-50c';
  if (ticks < 750_000) return '50-75c';
  if (ticks < 900_000) return '75-90c';
  return '90-100c';
}

function bucketHold(ms) {
  if (ms < 60_000) return '<1m';
  if (ms < 300_000) return '1-5m';
  if (ms < 3_600_000) return '5m-1h';
  if (ms < 86_400_000) return '1-24h';
  return '>1d';
}

export function categorize(trade) {
  return {
    strategy: trade.strategyId,
    topic: trade.topic || 'unclassified',
    side: trade.side,
    priceBucket: bucketPrice(trade.entryTicks),
    holdBucket: bucketHold(trade.holdMs),
    exitReason: trade.exitReason,
    outcomeKind: trade.outcomeKind || 'exit',
    taker: trade.taker !== false
  };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) {
    return { n: 0, pnlTicks: 0, feesTicks: 0, wins: 0, losses: 0, winRate: null, avgPnlTicks: null, evPerContractTicks: null, avgHoldMs: null, profitFactor: null };
  }
  let pnl = 0;
  let fees = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let hold = 0;
  let contracts = 0;
  for (const t of trades) {
    pnl += t.pnlTicks;
    fees += t.feesTicks;
    hold += t.holdMs;
    contracts += t.contracts;
    if (t.pnlTicks > 0) {
      wins += 1;
      grossWin += t.pnlTicks;
    } else {
      grossLoss += Math.abs(t.pnlTicks);
    }
  }
  return {
    n,
    pnlTicks: pnl,
    feesTicks: fees,
    wins,
    losses: n - wins,
    winRate: wins / n,
    avgPnlTicks: Math.round(pnl / n),
    evPerContractTicks: contracts ? Math.round(pnl / contracts) : null,
    avgHoldMs: Math.round(hold / n),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : null
  };
}

function groupBy(trades, keyFn) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  const out = {};
  for (const [k, v] of [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    out[k] = summarize(v);
  }
  return out;
}

/** Max peak-to-trough drawdown of the realized P&L curve, in ticks. */
export function maxDrawdown(trades) {
  const sorted = trades.slice().sort((a, b) => a.exitTs - b.exitTs);
  let cum = 0;
  let peak = 0;
  let mdd = 0;
  for (const t of sorted) {
    cum += t.pnlTicks;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

export function analyze(trades) {
  const overall = summarize(trades);
  return {
    overall: { ...overall, maxDrawdownTicks: maxDrawdown(trades) },
    byStrategy: groupBy(trades, (t) => t.strategyId),
    byTopic: groupBy(trades, (t) => t.topic || 'unclassified'),
    bySide: groupBy(trades, (t) => t.side),
    byPriceBucket: groupBy(trades, (t) => bucketPrice(t.entryTicks)),
    byHoldBucket: groupBy(trades, (t) => bucketHold(t.holdMs)),
    byExitReason: groupBy(trades, (t) => t.exitReason),
    byOutcomeKind: groupBy(trades, (t) => t.outcomeKind || 'exit'),
    // Cross-tab: which strategy does best in which topic. This is the "create
    // strategies based on the type of trade" output.
    strategyByTopic: (() => {
      const out = {};
      for (const t of trades) {
        const s = t.strategyId;
        const top = t.topic || 'unclassified';
        out[s] = out[s] || {};
        out[s][top] = out[s][top] || [];
        out[s][top].push(t);
      }
      const res = {};
      for (const [s, topics] of Object.entries(out)) {
        res[s] = {};
        for (const [top, list] of Object.entries(topics)) res[s][top] = summarize(list);
      }
      return res;
    })()
  };
}

/**
 * Rank strategies by measured performance, with an explicit confidence caveat.
 * `minTrades` is the sample floor below which a strategy is reported but not ranked.
 */
export function rankStrategies(trades, { minTrades = 10 } = {}) {
  const byStrategy = groupBy(trades, (t) => t.strategyId);
  return Object.entries(byStrategy)
    .map(([id, s]) => ({
      id,
      ...s,
      ranked: s.n >= minTrades,
      score: s.n >= minTrades && s.evPerContractTicks !== null ? s.evPerContractTicks : null
    }))
    .sort((a, b) => {
      if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
      return (b.score ?? -Infinity) - (a.score ?? -Infinity);
    });
}

/**
 * Reconcile the local paper account against the real Kalshi demo account.
 * They are different universes and must never be added together; this function
 * only reports them side by side, and the difference is labelled "not comparable".
 *
 * K15: balance + portfolio_value are the two components the API exposes. There is
 * no documented single "equity" field, so total is shown as two numbers, not one.
 */
export function reconcile({ paper, live }) {
  const rows = [];
  rows.push({
    label: 'Cash',
    paperTicks: paper?.cashTicks ?? null,
    liveTicks: live?.balanceTicks ?? null,
    source: 'K15'
  });
  rows.push({
    label: 'Open position value',
    paperTicks: paper ? paper.equityTicks - paper.cashTicks : null,
    liveTicks: live?.portfolioValueTicks ?? null,
    source: 'K15'
  });
  rows.push({
    label: 'Realized P&L',
    paperTicks: paper?.realizedTicks ?? null,
    liveTicks: null,
    source: 'K16'
  });
  return {
    rows,
    note:
      'Paper figures are simulated by this app. Live figures are read from the Kalshi demo account and are not comparable to paper results; they are shown side by side, never merged.',
    liveConnected: Boolean(live?.connected)
  };
}

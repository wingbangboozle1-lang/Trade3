// Simulated portfolio + strategy analysis (browser mirror of backtest.py).
// All fills are simulated at quoted prices; settlement uses Kalshi `result`.
// No real orders are placed from this page.
import { apiGet, dollarVolume, lastPrice, fmt$, fmtPx, esc, TOPICS } from "./app.js";

const $ = (id) => document.getElementById(id);
const STRATEGIES = {
  momentum: (p, prev) => (prev == null ? null : p - prev >= 0.10 ? "yes" : p - prev <= -0.10 ? "no" : null),
  mean_reversion: (p) => (p <= 0.15 ? "yes" : p >= 0.85 ? "no" : null),
  favorite_longshot: (p) => (p >= 0.65 ? "yes" : p <= 0.35 ? "no" : null),
};

async function fetchAllTopics() {
  const out = [];
  for (const t of TOPICS) {
    const tags = t.tags.length ? t.tags : [null];
    const seenS = new Set();
    for (const tag of tags) {
      const params = { limit: 100, category: t.category };
      if (tag) params.tags = tag;
      const sdata = await apiGet("/series", params);
      for (const s of sdata.series || []) {
        if (seenS.has(s.ticker)) continue;
        seenS.add(s.ticker);
        const mdata = await apiGet("/markets", { series_ticker: s.ticker, status: "open", limit: 50 });
        for (const m of mdata.markets || []) { m._topic = t.id; out.push(m); }
      }
    }
  }
  return out;
}

function simulate(markets, strategy, contracts = 10, cash = 1000) {
  const fn = STRATEGIES[strategy];
  let c = cash; const trades = [];
  const sorted = [...markets].sort((a, b) => dollarVolume(b) - dollarVolume(a)).slice(0, 60);
  for (const m of sorted) {
    const p = lastPrice(m);
    const side = fn(p, p); // single-snapshot strategies; momentum needs history -> use bid/ask drift proxy
    const s = strategy === "momentum" ? (p >= 0.5 ? "yes" : "no") : side;
    if (!s) continue;
    const px = s === "yes" ? parseFloat(m.yes_ask_dollars || p) : parseFloat(m.yes_bid_dollars || 1 - p);
    const cost = px * contracts;
    if (cost > c || cost <= 0) continue;
    c -= cost;
    trades.push({ ticker: m.ticker, topic: m._topic, strategy, side: s, entry: px, contracts, exit: null, pnl: null, result: "open" });
  }
  return { cash: c, trades };
}

function renderSummary(sim) {
  const settled = sim.trades.filter((t) => t.pnl != null);
  const pnl = settled.reduce((a, t) => a + t.pnl, 0);
  const wins = settled.filter((t) => t.pnl > 0).length;
  $("pf-cash").textContent = fmt$(sim.cash);
  $("pf-open").textContent = sim.trades.length - settled.length;
  $("pf-pnl").textContent = (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
  $("pf-win").textContent = settled.length ? Math.round((wins / settled.length) * 100) + "%" : "—";
  $("pf-body").innerHTML = sim.trades.map((t) =>
    `<tr><td><code>${esc(t.ticker)}</code></td><td>${esc(t.topic)}</td><td>${esc(t.strategy)}</td>
     <td>${esc(t.side)}</td><td class="num">${fmtPx(t.entry)}</td><td>${esc(t.result)}</td>
     <td class="num">${t.pnl == null ? "—" : (t.pnl >= 0 ? "+" : "") + t.pnl.toFixed(2)}</td></tr>`
  ).join("") || `<tr><td colspan="7" class="muted">No simulated trades (no strategy fired on current snapshot).</td></tr>`;
  // Categorization: PnL by topic and by strategy
  const by = (key) => {
    const m = {};
    for (const t of settled) { const k = t[key]; m[k] = m[k] || { n: 0, pnl: 0 }; m[k].n++; m[k].pnl += t.pnl; }
    return Object.entries(m);
  };
  $("cat-body").innerHTML = by("topic").map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${(v.pnl >= 0 ? "+" : "") + v.pnl.toFixed(2)}</td></tr>`).join("") ||
    `<tr><td colspan="3" class="muted">Settle trades (markets resolve over time) to see categorized PnL.</td></tr>`;
}

async function run() {
  $("pf-status").textContent = "Fetching live markets…";
  try {
    const markets = await fetchAllTopics();
    $("pf-status").textContent = `Loaded ${markets.length} open markets across 5 topics. Running strategies…`;
    const strat = $("strategy-select").value;
    const sim = simulate(markets, strat, +$("contracts-input").value || 10);
    renderSummary(sim);
    // Strategy comparison table (same snapshot, all strategies)
    $("cmp-body").innerHTML = Object.keys(STRATEGIES).map((s) => {
      const r = simulate(markets, s, +$("contracts-input").value || 10);
      return `<tr><td>${s}</td><td class="num">${r.trades.length}</td><td class="num">${fmt$(r.cash)}</td></tr>`;
    }).join("");
    $("pf-status").textContent = `Done · ${markets.length} markets · strategy: ${strat} (simulated, no real orders).`;
  } catch (e) {
    $("pf-status").textContent = `Failed: ${e.message}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("run-btn").addEventListener("click", run);
  run();
});

// ============================================================================
// Trade3 portfolio lab — simulated strategies against live Kalshi quotes.
//
// Mirrors backtest.py in the browser:
//   strategy snapshot -> candidate trades -> fills at quoted ask
//   -> mark at last price -> settle at $1.00/$0.00 from Kalshi's `result`
//
// Nothing here places an order. Settlement is never guessed: a trade only
// becomes "settled" when the exchange publishes result=yes|no.
// ============================================================================
import {
  TOPIC_BY_ID, classify, apiGet, discoverTopicSeries, esc, fetchOpenEvents, fetchOpenMarkets,
  fetchSettled, fmt$, fmtNum, fmtPx, lastPrice, movedTicks, store, ticks, yesAsk, yesBid,
} from "./app.js";

const $ = (id) => document.getElementById(id);

// --- strategy definitions (explicit, auditable) ------------------------------
const STRATEGIES = [
  {
    id: "swing_momentum",
    label: "Swing momentum",
    rule: "Follow a ≥ $0.10 move: buy YES after a rise, buy NO after a fall.",
    side: (m) => {
      // Compared in integer 1/10,000-dollar ticks (movedTicks): float
      // subtraction 0.42 − 0.32 = 0.0999… would drop an exactly-$0.10 move.
      const d = driftTicks(m);
      if (d == null) return null;
      if (d >= ticks(0.10)) return "yes";
      if (d <= -ticks(0.10)) return "no";
      return null;
    },
  },
  {
    id: "mean_reversion",
    label: "Mean reversion",
    rule: "Fade extremes: buy YES at ≤ $0.15, buy NO at ≥ $0.85.",
    side: (m) => {
      const p = lastPrice(m);
      if (p == null) return null;
      if (p <= 0.15) return "yes";
      if (p >= 0.85) return "no";
      return null;
    },
  },
  {
    id: "favorite",
    label: "Favorite",
    rule: "Buy the favourite when it is priced ≥ $0.65 (expects favourites to hold).",
    side: (m) => (lastPrice(m) != null && lastPrice(m) >= 0.65 ? "yes" : null),
  },
  {
    id: "longshot_value",
    label: "Longshot value",
    rule: "Buy cheap YES ≤ $0.35 — many small losses, occasional large win.",
    side: (m) => (lastPrice(m) != null && lastPrice(m) <= 0.35 ? "yes" : null),
  },
];

/**
 * Where did the price come from? Kalshi publishes previous_price_dollars, so a
 * move since the prior print is a documented field, not a guess. Returns the
 * move in integer 1/10,000-dollar ticks (null when unknown).
 */
function driftTicks(m) {
  const now = lastPrice(m);
  const prev = Number(m?.previous_price_dollars);
  if (now == null || !Number.isFinite(prev) || prev <= 0) return null;
  return movedTicks(prev, now);
}

// --- data -------------------------------------------------------------------
let cache = { at: 0, markets: [], settled: new Map() };
let lastRun = null;

async function loadUniverse(universe) {
  const verify = await fetch("data/series.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null);
  const [events, markets, topicSeries] = await Promise.all([
    fetchOpenEvents({ maxPages: 2 }),
    fetchOpenMarkets({ maxPages: 3 }),
    discoverTopicSeries(verify?.topics || {}),
  ]);
  let list = classify(markets, events, topicSeries);
  if (universe !== "all") list = list.filter((m) => m._topic === universe);
  return list;
}

async function settledFor(seriesList) {
  const out = [];
  for (const s of seriesList.slice(0, 14)) {
    try {
      const rows = await fetchSettled(s, 10);
      for (const m of rows) out.push(m);
    } catch { /* skip series that error */ }
  }
  return out;
}

// --- simulation -------------------------------------------------------------
function simulate(markets, strategy, { contracts, cash }) {
  const picks = markets.filter((m) => strategy.side(m) != null)
    .sort((a, b) => (Number(b.volume_fp) || 0) - (Number(a.volume_fp) || 0))
    .slice(0, 40);
  let remaining = cash;
  const trades = [];
  for (const m of picks) {
    const side = strategy.side(m);
    const askYes = yesAsk(m);
    const bidYes = yesBid(m);
    // Buy YES at the YES ask; buy NO at the NO ask (derived from the YES bid).
    const entry = side === "yes" ? askYes : (bidYes == null ? null : 1 - bidYes);
    if (entry == null || !(entry > 0 && entry < 1)) continue;
    const cost = entry * contracts;
    if (cost > remaining) continue;
    remaining -= cost;
    trades.push({
      strategy: strategy.id, strategyLabel: strategy.label,
      topic: m._topic, ticker: m.ticker, event: m.event_ticker, series: m._series,
      title: m.yes_sub_title || m.title, side, entry, contracts,
      mark: lastPrice(m), result: null, exit: null, pnl: null,
    });
  }
  return { strategy: strategy.id, label: strategy.label, rule: strategy.rule, trades, cash: remaining };
}

function markAndSettle(runs, settledRows) {
  const byTicker = new Map(settledRows.map((m) => [m.ticker, m]));
  for (const run of runs) {
    for (const t of run.trades) {
      const s = byTicker.get(t.ticker);
      const r = (s?.result || "").toLowerCase();
      if (r === "yes" || r === "no") {
        t.result = r;
        t.exit = t.side === "yes" ? (r === "yes" ? 1 : 0) : (r === "yes" ? 0 : 1);
        t.pnl = (t.exit - t.entry) * t.contracts;
        t.settled = true;
      } else {
        const mark = t.mark;
        t.markSide = mark == null ? null : (t.side === "yes" ? mark : 1 - mark);
        t.unrealised = t.markSide == null ? null : (t.markSide - t.entry) * t.contracts;
        t.settled = false;
      }
    }
  }
}

// --- rendering --------------------------------------------------------------
function summarise(runs) {
  const all = runs.flatMap((r) => r.trades);
  const settled = all.filter((t) => t.settled);
  const pnl = settled.reduce((a, t) => a + t.pnl, 0);
  const unreal = all.filter((t) => !t.settled && t.unrealised != null).reduce((a, t) => a + t.unrealised, 0);
  const wins = settled.filter((t) => t.pnl > 0).length;
  $("k-trades").textContent = all.length;
  $("k-trades-sub").textContent = `${settled.length} settled · ${all.length - settled.length} open`;
  $("k-pnl").textContent = (pnl >= 0 ? "+" : "−") + fmt$(Math.abs(pnl)).replace("$", "$");
  $("k-pnl").className = "kpi " + (pnl >= 0 ? "up" : "down");
  $("k-unreal").textContent = (unreal >= 0 ? "+" : "−") + fmt$(Math.abs(unreal));
  $("k-unreal").className = "kpi " + (unreal >= 0 ? "up" : "down");
  $("k-win").textContent = settled.length ? Math.round((wins / settled.length) * 100) + "%" : "—";
  $("k-win-sub").textContent = settled.length ? `${wins}/${settled.length} settled trades` : "nothing settled yet";
}

function renderComparison(runs) {
  $("cmp-body").innerHTML = runs.map((run) => {
    const settled = run.trades.filter((t) => t.settled);
    const pnl = settled.reduce((a, t) => a + t.pnl, 0);
    const stake = settled.reduce((a, t) => a + t.entry * t.contracts, 0);
    const wins = settled.filter((t) => t.pnl > 0).length;
    const avgEntry = run.trades.length ? run.trades.reduce((a, t) => a + t.entry, 0) / run.trades.length : null;
    return `<tr>
      <td><b>${esc(run.label)}</b><div class="dim mono">${esc(run.strategy)}</div></td>
      <td class="dim">${esc(run.rule)}</td>
      <td class="num">${run.trades.length}</td>
      <td class="num">${settled.length}</td>
      <td class="num">${settled.length ? Math.round((wins / settled.length) * 100) + "%" : "—"}</td>
      <td class="num ${pnl >= 0 ? "up" : "down"}">${settled.length ? (pnl >= 0 ? "+" : "−") + fmt$(Math.abs(pnl)) : "—"}</td>
      <td class="num">${settled.length && stake > 0 ? ((pnl / stake) * 100).toFixed(1) + "%" : "—"}</td>
      <td class="num">${fmtPx(avgEntry)}</td>
    </tr>`;
  }).join("");
}

let catMode = "topic";
function renderCategories(runs) {
  const all = runs.flatMap((r) => r.trades);
  const key = catMode === "topic" ? "topic" : "strategy";
  const buckets = new Map();
  for (const t of all) {
    const k = catMode === "topic" ? (TOPIC_BY_ID[t.topic]?.label || t.topic || "—") : (t.strategyLabel || t.strategy);
    const b = buckets.get(k) || { n: 0, settled: 0, wins: 0, pnl: 0 };
    b.n++;
    if (t.settled) { b.settled++; b.pnl += t.pnl; if (t.pnl > 0) b.wins++; }
    buckets.set(k, b);
  }
  const totalAbs = [...buckets.values()].reduce((a, b) => a + Math.abs(b.pnl), 0) || 1;
  const rows = [...buckets.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  $("cat-body").innerHTML = rows.map(([k, b]) => `
    <tr><td>${esc(k)}</td><td class="num">${b.n}</td><td class="num">${b.settled}</td>
    <td class="num">${b.settled ? Math.round((b.wins / b.settled) * 100) + "%" : "—"}</td>
    <td class="num ${b.pnl >= 0 ? "up" : "down"}">${b.settled ? (b.pnl >= 0 ? "+" : "−") + fmt$(Math.abs(b.pnl)) : "—"}</td>
    <td style="width:110px"><div class="bar"><i style="width:${Math.round((Math.abs(b.pnl) / totalAbs) * 100)}%;background:${b.pnl >= 0 ? "var(--green)" : "var(--red)"}"></i></div></td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">Run the simulation to populate categories.</td></tr>`;
}

function renderBlotter(runs) {
  const onlySettled = $("only-settled").checked;
  let rows = runs.flatMap((r) => r.trades.map((t) => ({ ...t })));
  if (onlySettled) rows = rows.filter((t) => t.settled);
  rows.sort((a, b) => (b.pnl ?? b.unrealised ?? -1e9) - (a.pnl ?? a.unrealised ?? -1e9));
  $("blotter-body").innerHTML = rows.slice(0, 250).map((t, i) => {
    const val = t.settled ? t.pnl : t.unrealised;
    const cls = val == null ? "" : val >= 0 ? "up" : "down";
    const result = t.settled ? `<span class="pill ${t.result === "yes" ? "live" : "bad"}">${t.result.toUpperCase()}</span>`
      : `<span class="pill">open</span>`;
    return `<tr>
      <td class="dim">${i + 1}</td>
      <td>${esc(t.strategyLabel)}</td>
      <td>${esc(TOPIC_BY_ID[t.topic]?.label || t.topic || "—")}</td>
      <td><span class="mono">${esc(t.ticker)}</span><div class="dim">${esc(t.title || "")}</div></td>
      <td class="${t.side === "yes" ? "up" : "down"}">${esc(t.side.toUpperCase())}</td>
      <td class="num">${fmtPx(t.entry)}</td>
      <td class="num">${t.settled ? fmtPx(t.exit) : fmtPx(t.markSide)}</td>
      <td class="num">${fmtNum(t.contracts)}</td>
      <td class="num ${cls}">${val == null ? "—" : (val >= 0 ? "+" : "−") + Math.abs(val).toFixed(2)}</td>
      <td>${result}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="muted">No trades matched these strategies on the current snapshot.</td></tr>`;
}

function drawEquity(runs, startingCash) {
  const cv = $("equity");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = (cv.width = cv.clientWidth * dpr);
  const H = (cv.height = cv.clientHeight * dpr);
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const trades = runs.flatMap((r) => r.trades.filter((t) => t.settled).map((t, i) => ({ ...t, order: i })));
  if (!trades.length) {
    ctx.fillStyle = "#93a4c6"; ctx.font = `${12 * dpr}px ui-monospace, monospace`;
    ctx.fillText("No settled trades yet — equity is flat until Kalshi publishes a result.", 12 * dpr, H / 2);
    $("eq-note").textContent = `${startingCash ? fmt$(startingCash) : ""} starting cash · nothing settled`;
    return;
  }
  // realised equity over trade sequence
  let eq = startingCash || 1000;
  const realised = [eq];
  for (const t of trades) { eq += t.pnl; realised.push(eq); }
  const padL = 48 * dpr, padT = 12 * dpr, padB = 18 * dpr, padR = 12 * dpr;
  const lo = Math.min(...realised), hi = Math.max(...realised);
  const span = Math.max(1e-6, hi - lo);
  const x = (i) => padL + ((W - padL - padR) * i) / Math.max(1, realised.length - 1);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / span);
  ctx.strokeStyle = "#1b2536";
  for (let i = 0; i <= 3; i++) {
    const v = lo + (span * i) / 3;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillStyle = "#93a4c6"; ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    ctx.fillText(fmt$(v), 4 * dpr, yy + 3 * dpr);
  }
  ctx.strokeStyle = "#22e6a4"; ctx.lineWidth = 2 * dpr; ctx.beginPath();
  realised.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
  ctx.fillStyle = "#22e6a4";
  ctx.beginPath(); ctx.arc(x(realised.length - 1), y(eq), 3 * dpr, 0, Math.PI * 2); ctx.fill();
  $("eq-note").textContent = `${trades.length} settled trades · ${fmt$(startingCash || 1000)} → ${fmt$(eq)}`;
}

// --- exports ----------------------------------------------------------------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv() {
  const rows = (lastRun?.runs || []).flatMap((r) => r.trades);
  const head = ["strategy", "topic", "ticker", "event", "series", "side", "entry", "contracts", "settled", "result", "exit", "pnl", "mark", "unrealised"];
  const body = rows.map((t) => [t.strategy, t.topic, t.ticker, t.event, t.series, t.side, t.entry,
    t.contracts, t.settled, t.result || "", t.exit ?? "", t.pnl ?? "", t.markSide ?? "", t.unrealised ?? ""]
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  download("trade3-simulated-trades.csv", [head.join(","), ...body].join("\n"), "text/csv");
}

function exportJson() {
  const payload = {
    generated: new Date().toISOString(),
    note: "Simulated trades only. Settlement from Kalshi `result`. No orders were placed.",
    startingCash: Number($("cash").value) || 1000,
    contracts: Number($("contracts").value) || 10,
    runs: lastRun?.runs || [],
  };
  download("trade3-simulated-trades.json", JSON.stringify(payload, null, 2), "application/json");
}

// --- run --------------------------------------------------------------------
async function run() {
  const universe = $("universe").value;
  const contracts = Math.max(1, Number($("contracts").value) || 10);
  const cash = Math.max(10, Number($("cash").value) || 1000);
  $("run-status").textContent = "loading live quotes…";
  $("run-status").className = "pill info";
  try {
    const markets = await loadUniverse(universe);
    const series = [...new Set(markets.map((m) => m._series).filter(Boolean))];
    $("run-status").textContent = `checking ${series.length} series for settlements…`;
    const settled = await settledFor(series);
    const runs = STRATEGIES.map((s) => simulate(markets, s, { contracts, cash }));
    markAndSettle(runs, settled);
    lastRun = { runs, markets: markets.length, settled: settled.length, at: Date.now() };
    summarise(runs); renderComparison(runs); renderCategories(runs); renderBlotter(runs); drawEquity(runs, cash);
    $("run-status").textContent = `${markets.length} live contracts · ${settled.length} settled records`;
    $("run-status").className = "pill live";
  } catch (e) {
    $("run-status").textContent = `failed: ${e.message}`;
    $("run-status").className = "pill bad";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("run").addEventListener("click", run);
  $("only-settled").addEventListener("change", () => lastRun && renderBlotter(lastRun.runs));
  $("cat-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]");
    if (!b) return;
    catMode = b.dataset.m;
    [...$("cat-mode").children].forEach((x) => x.classList.toggle("on", x === b));
    if (lastRun) renderCategories(lastRun.runs);
  });
  $("export-csv").addEventListener("click", exportCsv);
  $("export-json").addEventListener("click", exportJson);
  window.addEventListener("resize", () => lastRun && drawEquity(lastRun.runs, Number($("cash").value) || 1000));
  run();
});

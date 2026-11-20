// Live Kalshi dashboard — vanilla JS, no dependencies.
// Data: public REST (no auth). Polling by default; WebSocket needs API keys
// (see methodology page) so it is offered as an optional upgrade, not required.
import { DEMO_BASE, PROD_BASE, ALERT_THRESHOLD, TOPICS, getBase, setBase, apiGet,
  dollarVolume, lastPrice, fmt$, fmtPx, esc, kalshiMarketUrl, timeStr } from "./app.js";

const $ = (id) => document.getElementById(id);
const state = {
  topic: "gas",
  markets: [],          // current open markets for active topic
  series: [],
  prev: new Map(),      // ticker -> last price
  history: new Map(),   // ticker -> [{ts, price}]
  alerts: [],           // all alerts
  roiAlerts: [],        // high-ROI subset
  selected: null,       // selected market ticker
  windowSec: 3600,      // chart window: 60, 300, 3600, 86400
  pollMs: 10000,
  timer: null,
  resolved: [],         // settled markets tracked until resolution
  paper: JSON.parse(localStorage.getItem("kalshi-paper") || "[]"),
  medianVol: 0,
};

function savePaper() { localStorage.setItem("kalshi-paper", JSON.stringify(state.paper.slice(-200))); }

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Threshold comparisons are done in integer 1/10000-dollar space (Kalshi prices have
// 4 decimals) so a move of exactly $0.10 always fires: floating-point subtraction can
// turn 0.42 - 0.32 into 0.09999..., which would silently drop a qualifying alert.
const THRESH_TICKS = Math.round(ALERT_THRESHOLD * 10000);
function meetsThreshold(a, b) {
  const ta = Math.round(Number(a) * 10000), tb = Math.round(Number(b) * 10000);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(tb - ta) >= THRESH_TICKS;
}

function isHighRoi(m, prevPrice) {
  const p = lastPrice(m);
  if (p < 0.15 || p > 0.85) return false;
  if (dollarVolume(m) < state.medianVol) return false;
  const bid = parseFloat(m.yes_bid_dollars), ask = parseFloat(m.yes_ask_dollars);
  if (!isNaN(bid) && !isNaN(ask) && ask - bid > 0.10) return false;
  // |move| >= $0.05, compared in tick space (1/10000-dollar units)
  if (prevPrice != null && Math.abs(Math.round(p * 10000) - Math.round(prevPrice * 10000)) < 500) return false;
  return true;
}

async function discoverTopic(topicId) {
  const t = TOPICS.find((x) => x.id === topicId);
  // A topic may span two Kalshi categories (verified 2026-11-20: "Culture" IS a Kalshi
  // category — GET /series?category=Culture returns series — and Entertainment is kept as a
  // supplementary proxy because Culture series are often closed on the demo environment).
  const categories = t.categories || (t.category ? [t.category] : [null]);
  const tags = t.tags.length ? t.tags : [null];
  const series = [];
  const seenSeries = new Set();
  for (const category of categories) {
    for (const tag of tags) {
      const params = { limit: 100 };
      if (category) params.category = category;
      if (tag) params.tags = tag;
      const data = await apiGet("/series", params);
      for (const s of data.series || []) {
        if (!seenSeries.has(s.ticker)) { seenSeries.add(s.ticker); series.push(s); }
      }
    }
  }
  const markets = [];
  const seen = new Set();
  for (const s of series) {
    const data = await apiGet("/markets", { series_ticker: s.ticker, status: "open", limit: 100 });
    for (const m of data.markets || []) {
      if (!seen.has(m.ticker)) {
        seen.add(m.ticker);
        m._series_title = s.title || "";
        m._topic = topicId;
        markets.push(m);
      }
    }
  }
  markets.sort((a, b) => dollarVolume(b) - dollarVolume(a));
  return { series, markets };
}

function renderStatus(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.className = "pill " + (ok ? "live" : "bad");
}

function renderEvents() {
  // Group markets by event, sum dollar volume -> "highest dollar amount events"
  const byEvent = new Map();
  for (const m of state.markets) {
    const e = byEvent.get(m.event_ticker) || { event: m.event_ticker, markets: 0, dv: 0, best: m };
    e.markets += 1; e.dv += dollarVolume(m);
    if (dollarVolume(m) > dollarVolume(e.best)) e.best = m;
    byEvent.set(m.event_ticker, e);
  }
  const events = [...byEvent.values()].sort((a, b) => b.dv - a.dv).slice(0, 10);
  $("events-body").innerHTML = events.map((e, i) =>
    `<tr><td>${i + 1}</td><td><code>${esc(e.event)}</code></td><td class="num">${e.markets}</td>
     <td class="num">${fmt$(e.dv)}</td><td>${esc(e.best.title || "")}</td>
     <td><a href="${kalshiMarketUrl(e.best.ticker)}" target="_blank" rel="noopener">API</a></td></tr>`
  ).join("") || `<tr><td colspan="6" class="muted">No open markets right now for this topic.</td></tr>`;
}

function renderMarkets() {
  const top = state.markets.slice(0, 25);
  $("markets-body").innerHTML = top.map((m) => {
    const p = lastPrice(m);
    const old = state.prev.get(m.ticker);
    const d = old != null ? p - old : 0;
    const cls = meetsThreshold(p, old) && d > 0 ? "up" : meetsThreshold(p, old) && d < 0 ? "down" : "";
    const sel = m.ticker === state.selected ? " style='background:#1a2c4d'" : "";
    return `<tr${sel} data-ticker="${esc(m.ticker)}" style="cursor:pointer">
      <td><code>${esc(m.ticker)}</code></td>
      <td>${esc(m.title || "")}<br><span class="muted">${esc(m._series_title || "")} · ${esc(m.event_ticker || "")}</span></td>
      <td class="num ${cls}">${fmtPx(p)}${d ? ` <span class="${cls}">(${d >= 0 ? "+" : ""}${d.toFixed(2)})</span>` : ""}</td>
      <td class="num">${fmtPx(m.yes_bid_dollars)} / ${fmtPx(m.yes_ask_dollars)}</td>
      <td class="num">${fmt$(dollarVolume(m))}</td>
      <td class="num">${esc(m.volume_fp || "—")}</td>
      <td>${esc(m.close_time || "—")}</td></tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">No open markets.</td></tr>`;
  document.querySelectorAll("#markets-body tr[data-ticker]").forEach((tr) => {
    tr.addEventListener("click", () => { state.selected = tr.dataset.ticker; renderMarkets(); drawChart(); loadOrderbook(); });
  });
}

function pushAlert(m, oldPrice) {
  const p = lastPrice(m);
  const delta = p - oldPrice;
  const roi = isHighRoi(m, oldPrice);
  const alert = { ts: Date.now(), ticker: m.ticker, title: m.title || "", topic: m._topic,
    from: oldPrice, to: p, delta, roi, url: kalshiMarketUrl(m.ticker) };
  state.alerts.unshift(alert);
  if (roi) state.roiAlerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 200);
  state.roiAlerts = state.roiAlerts.slice(0, 200);
  renderChat($("chat-all"), state.alerts);
  renderChat($("chat-roi"), state.roiAlerts);
  // Paper trade on high-ROI alerts (simulated; see portfolio page)
  if (roi && !state.paper.some((t) => t.ticker === m.ticker && t.exit == null)) {
    const side = delta >= 0 ? "yes" : "no";
    state.paper.push({ ticker: m.ticker, topic: m._topic, strategy: "momentum+roi-filter",
      side, entry: p, ts: Date.now(), exit: null, pnl: null });
    savePaper(); renderPaper();
  }
}

function renderChat(el, list) {
  if (!el) return;
  el.innerHTML = list.map((a) =>
    `<div class="msg ${a.roi ? "roi" : ""}"><span class="t">${timeStr(a.ts)} · ${esc(a.topic)}</span><br>
     <b><a href="${esc(a.url || "#")}" target="_blank" rel="noopener">${esc(a.ticker)}</a></b> ${esc(a.title)}<br>
     <span class="${a.delta >= 0 ? "up" : "down"}">${fmtPx(a.from)} → ${fmtPx(a.to)} (${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(2)})</span>
     ${a.roi ? ' <span class="pill live">HIGH-ROI</span>' : ""}</div>`
  ).join("") || `<div class="msg muted">No ≥ $0.10 swings yet this session. Polling every ${state.pollMs / 1000}s…</div>`;
}

function renderPaper() {
  const el = $("paper-body");
  if (!el) return;
  el.innerHTML = state.paper.slice(-10).reverse().map((t) =>
    `<tr><td><code>${esc(t.ticker)}</code></td><td>${esc(t.topic)}</td><td>${esc(t.strategy)}</td>
     <td>${esc(t.side)}</td><td class="num">${fmtPx(t.entry)}</td><td>${t.exit == null ? "open" : fmtPx(t.exit)}</td>
     <td class="num">${t.pnl == null ? "—" : (t.pnl >= 0 ? "+" : "") + t.pnl.toFixed(2)}</td></tr>`
  ).join("") || `<tr><td colspan="7" class="muted">No paper trades yet. High-ROI alerts open simulated trades automatically.</td></tr>`;
}

function drawChart() {
  const cv = $("chart");
  if (!cv || !state.selected) return;
  const ctx = cv.getContext("2d");
  const W = (cv.width = cv.clientWidth * devicePixelRatio);
  const H = (cv.height = cv.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, W, H);
  const hist = (state.history.get(state.selected) || []).filter((h) => Date.now() - h.ts <= state.windowSec * 1000);
  ctx.fillStyle = "#9db0d6"; ctx.font = `${12 * devicePixelRatio}px system-ui`;
  if (hist.length < 2) {
    ctx.fillText("Collecting price history… select a market, then wait for polls.", 20 * devicePixelRatio, 30 * devicePixelRatio);
    return;
  }
  const padL = 44 * devicePixelRatio, padR = 12 * devicePixelRatio, padT = 14 * devicePixelRatio, padB = 26 * devicePixelRatio;
  const t0 = hist[0].ts, t1 = hist[hist.length - 1].ts || Date.now();
  const x = (ts) => padL + (W - padL - padR) * ((ts - t0) / Math.max(1, t1 - t0));
  const y = (p) => padT + (H - padT - padB) * (1 - p); // price 0..1
  // grid + y labels
  ctx.strokeStyle = "#24345a"; ctx.fillStyle = "#9db0d6";
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.beginPath(); ctx.moveTo(padL, y(p)); ctx.lineTo(W - padR, y(p)); ctx.stroke();
    ctx.fillText("$" + p.toFixed(2), 4, y(p) + 4 * devicePixelRatio);
  }
  // x labels (first/mid/last)
  ctx.fillText(new Date(t0).toLocaleTimeString(), padL, H - 8 * devicePixelRatio);
  ctx.fillText(new Date(t1).toLocaleTimeString(), W - padR - 70 * devicePixelRatio, H - 8 * devicePixelRatio);
  // price line
  ctx.strokeStyle = "#00dd94"; ctx.lineWidth = 2 * devicePixelRatio; ctx.beginPath();
  hist.forEach((h, i) => { const px = x(h.ts), py = y(h.price); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();
  // alert markers (>= $0.10 steps, compared in tick space)
  ctx.fillStyle = "#ffb454";
  for (let i = 1; i < hist.length; i++) {
    if (meetsThreshold(hist[i - 1].price, hist[i].price)) {
      ctx.beginPath(); ctx.arc(x(hist[i].ts), y(hist[i].price), 4 * devicePixelRatio, 0, 7); ctx.fill();
    }
  }
  const last = hist[hist.length - 1];
  $("chart-info").textContent = `${state.selected} · ${hist.length} points · window ${state.windowSec}s · last ${fmtPx(last.price)} at ${timeStr(last.ts)}`;
}

async function loadOrderbook() {
  if (!state.selected) return;
  try {
    const data = await apiGet(`/markets/${encodeURIComponent(state.selected)}/orderbook`, { depth: 10 });
    const ob = data.orderbook_fp || {};
    const rows = (arr, side) => (arr || []).slice(-10).reverse().map(([px, qty]) =>
      `<tr><td>${side}</td><td class="num">${fmtPx(px)}</td><td class="num">${esc(qty)}</td></tr>`).join("");
    $("book-body").innerHTML = rows(ob.yes_dollars, "YES bid") + rows(ob.no_dollars, "NO bid") ||
      `<tr><td colspan="3" class="muted">Empty book.</td></tr>`;
  } catch (e) {
    $("book-body").innerHTML = `<tr><td colspan="3" class="muted">Orderbook unavailable: ${esc(e.message)}</td></tr>`;
  }
}

async function loadCandles() {
  // Backfill chart history from candlesticks (1-min bars) for the selected market.
  if (!state.selected) return;
  const m = state.markets.find((x) => x.ticker === state.selected);
  if (!m) return;
  const seriesTicker = m.ticker.split("-")[0]; // fallback; prefer event prefix
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.min(state.windowSec, 86400);
  try {
    const data = await apiGet(`/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(state.selected)}/candlesticks`,
      { start_ts: start, end_ts: end, period_interval: 1 });
    const candles = data.candlesticks || [];
    if (candles.length) {
      const hist = candles.map((c) => ({ ts: c.end_period_ts * 1000, price: parseFloat(c.price?.close_dollars || "0") || 0 }));
      const existing = state.history.get(state.selected) || [];
      const merged = [...hist, ...existing].sort((a, b) => a.ts - b.ts);
      state.history.set(state.selected, merged.slice(-2000));
      drawChart();
    }
  } catch { /* live poll points still chart; ignore candle errors */ }
}

async function poll() {
  try {
    const { series, markets } = await discoverTopic(state.topic);
    state.series = series; state.markets = markets;
    state.medianVol = median(markets.map(dollarVolume));
    const now = Date.now();
    for (const m of markets) {
      const p = lastPrice(m);
      const old = state.prev.get(m.ticker);
      if (old != null && meetsThreshold(old, p)) pushAlert(m, old);
      state.prev.set(m.ticker, p);
      const h = state.history.get(m.ticker) || [];
      h.push({ ts: now, price: p });
      state.history.set(m.ticker, h.slice(-2000));
    }
    if (!state.selected && markets.length) state.selected = markets[0].ticker;
    $("kpi-markets").textContent = markets.length;
    $("kpi-events").textContent = new Set(markets.map((m) => m.event_ticker)).size;
    $("kpi-top").textContent = markets.length ? fmt$(dollarVolume(markets[0])) : "—";
    $("kpi-alerts").textContent = state.alerts.length;
    renderEvents(); renderMarkets(); drawChart(); loadOrderbook();
    renderStatus(`Live · ${getBase().includes("demo") ? "DEMO" : "PROD"} · ${state.topic} · ${markets.length} open markets · updated ${timeStr(now)}`);
  } catch (e) {
    renderStatus(`Fetch failed: ${e.message} — check network/CORS, then retry.`, false);
  }
}

async function pollResolved() {
  // Track settled markets for the topic's series (resolution yes/no).
  try {
    const out = [];
    for (const s of state.series.slice(0, 8)) {
      const data = await apiGet("/markets", { series_ticker: s.ticker, status: "settled", limit: 20 });
      for (const m of data.markets || []) out.push(m);
    }
    state.resolved = out.slice(0, 20);
    $("resolved-body").innerHTML = state.resolved.map((m) =>
      `<tr><td><code>${esc(m.ticker)}</code></td><td>${esc(m.title || "")}</td>
       <td>${esc(m.result || "—")}</td><td>${esc(m.settlement_ts || m.close_time || "—")}</td></tr>`
    ).join("") || `<tr><td colspan="4" class="muted">No settled markets in the latest batch.</td></tr>`;
    // Settle paper trades
    for (const t of state.paper) {
      if (t.exit == null) {
        const m = state.resolved.find((x) => x.ticker === t.ticker);
        if (m && m.result) {
          const payout = m.result === "yes" ? 1 : 0;
          t.exit = t.side === "yes" ? payout : 1 - payout;
          t.pnl = (t.exit - t.entry) * 10;
          t.result = m.result;
        }
      }
    }
    savePaper(); renderPaper();
  } catch { /* non-critical */ }
}

function start() {
  $("base-toggle").value = getBase();
  $("base-toggle").addEventListener("change", (e) => { setBase(e.target.value); location.reload(); });
  $("topic-tabs").innerHTML = TOPICS.map((t) =>
    `<button data-topic="${t.id}" class="${t.id === state.topic ? "" : "muted"}">${t.label}</button>`).join("");
  document.querySelectorAll("#topic-tabs button").forEach((b) =>
    b.addEventListener("click", () => { state.topic = b.dataset.topic; state.selected = null; poll(); }));
  $("window-select").addEventListener("change", (e) => { state.windowSec = +e.target.value; drawChart(); loadCandles(); });
  $("poll-select").addEventListener("change", (e) => {
    state.pollMs = +e.target.value;
    clearInterval(state.timer); state.timer = setInterval(poll, state.pollMs);
  });
  $("refresh-btn").addEventListener("click", poll);
  $("clear-btn").addEventListener("click", () => { state.paper = []; savePaper(); renderPaper(); });
  poll();
  state.timer = setInterval(poll, state.pollMs);
  setInterval(pollResolved, 60000);
  pollResolved();
  setInterval(loadCandles, 60000);
  window.addEventListener("resize", drawChart);
}

document.addEventListener("DOMContentLoaded", start);

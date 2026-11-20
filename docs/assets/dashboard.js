// ============================================================================
// Trade3 live dashboard.
//
// Pipeline per refresh:
//   1. GET /events?status=open        -> event -> {category, series_ticker}
//   2. GET /markets?status=open       -> every open contract (mve excluded)
//   3. classify() keeps only the five requested topics, exactly
//   4. diff against the previous snapshot -> ≥ $0.10 alerts, session moves
//   5. quote the book for alerts + the selected contract (depth, spread)
//   6. chart from candlesticks (1 min / 1 h / 1 day bars) + live poll points
//
// Nothing is estimated. Missing values render as "—".
// ============================================================================
import {
  ALERT_THRESHOLD, TOPICS, TOPIC_BY_ID, apiGet, baseUrls, candlePlan, classify,
  clockStr, depthWithin, discoverTopicSeries, esc, fetchCandles, fetchOpenEvents,
  fetchOpenMarkets, fetchOrderbook, fetchSettled, fmt$, fmtDelta, fmtNum, fmtPx,
  getEnv, getPollMs, kalshiSeriesUrl, apiMarketUrl, lastPrice, netStats, roiCheck,
  setEnv, setPollMs, store, timeStr, until, yesAsk, yesBid, bookSummary, bookDepth,
} from "./app.js";

const $ = (id) => document.getElementById(id);
const WINDOWS = [60, 300, 900, 3600, 21600, 86400, 604800];

const state = {
  topic: "all",
  markets: [],            // classified open contracts in scope
  allMarkets: [],
  events: new Map(),      // event_ticker -> event record
  seriesInfo: new Map(),  // series_ticker -> {title, settlement, category}
  prev: new Map(),        // ticker -> last observed price
  history: new Map(),     // ticker -> [{ts, price}] live poll points
  alerts: [],             // every ≥ $0.10 swing this session
  roiAlerts: [],
  sessionOpen: new Map(), // ticker -> first price seen this session
  selected: null,
  windowSec: 3600,
  candleCache: new Map(), // cacheKey -> {at, points}
  pollMs: getPollMs(),
  timer: null,
  paused: false,
  freezeFeed: false,
  groupByTopic: true,
  moversOnly: false,
  sound: store.get("sound", false),
  book: null,
  paper: store.get("paper", []),
  resolved: [],
  loading: false,
  lastRefresh: null,
  error: null,
};

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  $("env-select").value = getEnv();
  $("poll-select").value = String(state.pollMs);
  $("sound-toggle").checked = state.sound;

  $("env-select").addEventListener("change", (e) => { setEnv(e.target.value); hardRefresh(); });
  $("poll-select").addEventListener("change", (e) => {
    state.pollMs = Number(e.target.value); setPollMs(state.pollMs); startTimer();
  });
  $("pause-btn").addEventListener("click", () => {
    state.paused = !state.paused;
    $("pause-btn").textContent = state.paused ? "Resume" : "Pause";
    $("pause-btn").classList.toggle("primary", state.paused);
    startTimer();
  });
  $("refresh-btn").addEventListener("click", () => refresh(true));
  $("group-toggle").addEventListener("change", (e) => { state.groupByTopic = e.target.checked; renderEvents(); });
  $("movers-toggle").addEventListener("change", (e) => { state.moversOnly = e.target.checked; renderEvents(); });
  $("pausefeed").addEventListener("change", (e) => { state.freezeFeed = e.target.checked; });
  $("sound-toggle").addEventListener("change", (e) => {
    state.sound = e.target.checked; store.set("sound", state.sound);
    if (state.sound) beep(0.02); // unlock audio on user gesture
  });
  $("window-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-win]");
    if (!b) return;
    state.windowSec = Number(b.dataset.win);
    [...$("window-tabs").children].forEach((x) => x.classList.toggle("on", x === b));
    drawChart(true);
  });
  $("res-refresh").addEventListener("click", () => refreshResolutions(true));

  renderTopicTabs();
  buildChats();
  renderPaper();
  window.addEventListener("hashchange", () => {
    if (selectFromHash()) { renderEvents(); renderDetail(); drawChart(true); }
  });
  startTimer();
  refresh();
  refreshResolutions();
});

function startTimer() {
  if (state.timer) clearInterval(state.timer);
  if (state.paused) return;
  state.timer = setInterval(() => refresh(), state.pollMs);
}

function hardRefresh() {
  state.prev.clear(); state.history.clear(); state.sessionOpen.clear();
  state.alerts = []; state.roiAlerts = []; state.candleCache.clear();
  state.book = null; state.selected = null;
  renderTopicTabs(); buildChats(); renderEvents(); drawChart(true); refresh(true);
}

// ---------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------
function renderTopicTabs() {
  const tabs = [{ id: "all", label: "All five topics" }, ...TOPICS];
  $("topic-tabs").innerHTML = tabs.map((t) =>
    `<button data-topic="${t.id}" class="${t.id === state.topic ? "on" : ""}">${esc(t.label)}</button>`).join("");
  $("topic-tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    state.topic = b.dataset.topic;
    state.selected = null;
    renderTopicTabs();
    renderEvents(); renderDetail(); drawChart(true); refreshResolutions();
  }));
}

function inScope(m) { return state.topic === "all" || m._topic === state.topic; }
function scoped() { return state.markets.filter(inScope); }

// ---------------------------------------------------------------------------
// refresh cycle
// ---------------------------------------------------------------------------
async function refresh(manual = false) {
  if (state.loading) return;
  state.loading = true;
  setStatus("Refreshing…", "info");
  try {
    const verified = (await loadVerified()) || {};
    const [events, markets, topicSeries] = await Promise.all([
      fetchOpenEvents({ maxPages: 3 }),
      fetchOpenMarkets({ maxPages: 4 }),
      discoverTopicSeries(verified),
    ]);

    state.events = new Map(events.map((e) => [e.event_ticker, e]));
    state.allMarkets = markets;
    const classified = classify(markets, events, topicSeries);

    // keep series metadata (settlement source etc.) for the facts panel
    for (const [id, set] of Object.entries(topicSeries)) {
      for (const s of set.values()) {
        if (!state.seriesInfo.has(s.ticker)) state.seriesInfo.set(s.ticker, { ...s, topic: id });
      }
    }
    await hydrateSeriesInfo(classified);

    state.markets = classified;
    const now = Date.now();
    // Awaited: the alert feeds and any simulated trade they open must be on
    // screen in the same render pass that shows the new snapshot.
    await detectSwings(classified, now);
    for (const m of classified) {
      state.prev.set(m.ticker, lastPrice(m));
      if (!state.sessionOpen.has(m.ticker)) state.sessionOpen.set(m.ticker, lastPrice(m));
      const h = state.history.get(m.ticker) || [];
      const p = lastPrice(m);
      if (p != null && (!h.length || now - h[h.length - 1].ts > 1000)) h.push({ ts: now, price: p });
      state.history.set(m.ticker, h.slice(-1200));
    }

    // Deep link: dashboard.html#<ticker> wins over the default selection, so a
    // link to one contract can be shared and reloaded.
    if (!selectFromHash() && (!state.selected || !state.markets.some((m) => m.ticker === state.selected))) {
      const top = [...scoped()].sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0))[0];
      state.selected = top ? top.ticker : null;
    }

    state.lastRefresh = now;
    state.error = null;
    renderKpis(); renderEvents(); renderDetail(); renderPaper(); drawChart();
    const s = netStats();
    const n = scoped().length;
    setStatus(`Live · ${getEnv() === "demo" ? "demo" : "production"} · ${n} contracts in scope · updated ${timeStr(now)}`, "live");
    $("netinfo").textContent = `${s.requests} requests · ${s.host.replace("https://", "")}`;
    if (manual) toast("Refreshed.");
  } catch (e) {
    state.error = String(e && e.message || e);
    setStatus(`Fetch failed — ${state.error}`, "bad");
    toast(`Connection problem: ${state.error}. See Method → network for a proxy option.`, 8000);
  } finally {
    state.loading = false;
  }
}

async function loadVerified() {
  try {
    const r = await fetch("data/series.json", { cache: "no-cache" });
    if (!r.ok) return null;
    const d = await r.json();
    return d.topics || null;
  } catch { return null; }
}

/** Fill in settlement source + event title for the contracts we show. */
async function hydrateSeriesInfo(markets) {
  const missing = [...new Set(markets.map((m) => m._series))]
    .filter((s) => s && !state.seriesInfo.has(s));
  for (const s of missing.slice(0, 25)) {
    try {
      const d = await apiGet(`/series/${encodeURIComponent(s)}`);
      const rec = d.series || {};
      state.seriesInfo.set(s, {
        ticker: s, title: rec.title, category: rec.category,
        settlement: (rec.settlement_sources || [])[0] || null,
        allSources: rec.settlement_sources || [],
        tags: rec.tags || [],
      });
    } catch { /* leave unknown -> renders as "—" */ }
  }
}

// ---------------------------------------------------------------------------
// swing detection
// ---------------------------------------------------------------------------
async function detectSwings(markets, now) {
  const hits = [];
  for (const m of markets) {
    const p = lastPrice(m);
    const old = state.prev.get(m.ticker);
    if (p == null || old == null || !inScope(m)) continue;
    const delta = p - old;
    if (Math.abs(delta) >= ALERT_THRESHOLD - 1e-9) hits.push({ m, delta, from: old, to: p });
  }
  // Quote the book only for fresh swings (keeps request count low).
  for (const h of hits.slice(0, 12)) {
    let ob = null;
    try { ob = await fetchOrderbook(h.m.ticker, 15); } catch { /* book optional */ }
    const bs = ob ? bookSummary(ob) : { spread: null };
    const depth = ob ? depthWithin(ob, 0.03, "yes") + depthWithin(ob, 0.03, "no") : null;
    const screen = roiCheck({
      price: h.to, delta: h.delta, spread: bs.spread,
      dollarVol: (Number(h.m.volume_fp) || 0) * h.to, depth,
    });
    const alert = {
      ts: now, ticker: h.m.ticker, title: h.m.title || h.m._eventTitle || h.m.ticker,
      topic: h.m._topic, from: h.from, to: h.to, delta: h.delta,
      spread: bs.spread, depth, roi: screen.pass, why: screen.reasons,
      event: h.m.event_ticker, series: h.m._series,
    };
    state.alerts.unshift(alert);
    if (alert.roi) state.roiAlerts.unshift(alert);
    if (alert.roi) openPaperTrade(alert, h.m);
  }
  state.alerts = state.alerts.slice(0, 400);
  state.roiAlerts = state.roiAlerts.slice(0, 200);
  if (hits.length) {
    renderChats();
    renderPaper();
    if (state.sound) beep(0.08);
    const biggest = hits.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
    toast(`${hits.length} swing${hits.length > 1 ? "s" : ""} ≥ $0.10 · biggest ${biggest.m.ticker} ${fmtDelta(biggest.delta)}`);
  }
}

// ---------------------------------------------------------------------------
// chats
// ---------------------------------------------------------------------------
function buildChats() { renderChats(); }

function renderChats() {
  const all = $("chat-all"), roi = $("chat-roi");
  if (!all || !roi) return;
  const emptyAll = `<div class="msg"><span class="t">waiting</span><br>No ≥ $0.10 swing seen yet. The feed fills in as prices move; refresh interval is ${state.pollMs / 1000}s.</div>`;
  const emptyRoi = `<div class="msg"><span class="t">waiting</span><br>Nothing has passed the high-ROI screen yet this session. That is expected — the screen is deliberately strict.</div>`;
  if (!state.freezeFeed) {
    all.innerHTML = state.alerts.map(alertRow).join("") || emptyAll;
    roi.innerHTML = state.roiAlerts.map(alertRow).join("") || emptyRoi;
  }
  $("chat-count").textContent = state.alerts.length;
  $("chat-roi-count").textContent = state.roiAlerts.length;
  $("kpi-alerts").textContent = state.alerts.length;
  $("kpi-roi").textContent = state.roiAlerts.length;
  all.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => select(el.dataset.pick)));
  roi.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => select(el.dataset.pick)));
}

function alertRow(a) {
  const dir = a.delta >= 0 ? "up" : "down";
  const arrow = a.delta >= 0 ? "▲" : "▼";
  const topic = TOPIC_BY_ID[a.topic]?.label || a.topic || "—";
  const why = a.roi ? "" : (a.why || []).length ? `<div class="why">filtered out: ${esc(a.why.join(" · "))}</div>` : "";
  return `<div class="msg ${dir} ${a.roi ? "roi" : ""}">
    <span class="t">${timeStr(a.ts)} · ${esc(topic)}</span> <span class="pill ${a.roi ? "roi" : ""}">${arrow} ${fmtDelta(a.delta)}</span>
    <div class="mkt" data-pick="${esc(a.ticker)}" style="cursor:pointer">${esc(a.ticker)}</div>
    <div class="ttl">${esc(a.title)}</div>
    <div class="${dir}">${fmtPx(a.from)} → ${fmtPx(a.to)}</div>
    <div class="why">spread ${a.spread == null ? "—" : fmtPx(a.spread)} · depth ${a.depth == null ? "—" : fmtNum(a.depth)} · <a href="${esc(apiMarketUrl(a.ticker))}" target="_blank" rel="noopener">API record</a></div>
    ${why}
  </div>`;
}

// ---------------------------------------------------------------------------
// KPIs + events table
// ---------------------------------------------------------------------------
function renderKpis() {
  const list = scoped();
  $("kpi-markets").textContent = list.length;
  const events = new Set(list.map((m) => m.event_ticker));
  $("kpi-events").textContent = events.size;
  $("kpi-topics-sub").textContent = state.topic === "all"
    ? "across gas · elections · culture · crypto · golf"
    : TOPIC_BY_ID[state.topic]?.label || "";
  const topEvent = rankEvents(list)[0];
  $("kpi-top").textContent = topEvent ? fmt$(topEvent.dollars) : "—";
  $("kpi-top-sub").textContent = topEvent ? topEvent.event.title.slice(0, 46) : "no open contracts in scope";
}

function rankEvents(list) {
  const by = new Map();
  for (const m of list) {
    const e = state.events.get(m.event_ticker) || {};
    const rec = by.get(m.event_ticker) || {
      event: {
        ticker: m.event_ticker, title: e.title || m._eventTitle || m.event_ticker,
        sub: e.sub_title || m._eventSub || "", series: e.series_ticker || m._series,
        category: e.category || m._category,
      },
      topic: m._topic, markets: [], dollars: 0, top: m,
    };
    rec.markets.push(m);
    rec.dollars += (Number(m.volume_fp) || 0) * (lastPrice(m) || 0);
    if ((Number(m.volume_fp) || 0) > (Number(rec.top.volume_fp) || 0)) rec.top = m;
    by.set(m.event_ticker, rec);
  }
  return [...by.values()].sort((a, b) => b.dollars - a.dollars);
}

function renderEvents() {
  const body = $("events-body");
  if (!body) return;
  let list = scoped();
  if (state.moversOnly) {
    const moved = new Set(state.alerts.map((a) => a.event));
    list = list.filter((m) => moved.has(m.event_ticker));
  }
  const ranked = rankEvents(list);
  if (!ranked.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">No open contracts in this topic right now. That is normal for demo data — switch topic or try production.</td></tr>`;
    return;
  }
  const rows = [];
  let currentTopic = null;
  for (const ev of ranked) {
    if (state.groupByTopic && ev.topic !== currentTopic) {
      currentTopic = ev.topic;
      const t = TOPIC_BY_ID[currentTopic];
      rows.push(`<tr><td colspan="8" style="background:var(--panel-2);color:var(--green-2);font-weight:700;font-size:12.5px">
        ${esc(t?.label || currentTopic)} <span class="dim">— ${esc(t?.blurb || "")}</span></td></tr>`);
    }
    const move = sessionMove(ev.top);
    const dir = move == null ? "flat" : move > 0 ? "up" : move < 0 ? "down" : "flat";
    rows.push(`<tr class="clickable" data-pick="${esc(ev.top.ticker)}">
      <td><b>${esc(ev.event.title)}</b><div class="dim">${esc(ev.event.sub || "")} · <span class="mono">${esc(ev.event.ticker)}</span></div></td>
      <td class="num">${fmtNum(ev.markets.length)}</td>
      <td class="num">${fmt$(ev.dollars)}</td>
      <td class="num">${esc(shortTitle(ev.top))}</td>
      <td class="num">${fmtPx(lastPrice(ev.top))}</td>
      <td class="num ${dir}">${move == null ? "—" : fmtDelta(move)}</td>
      <td class="nowrap">${esc(until(ev.top.close_time))}</td>
      <td class="nowrap">
        ${seriesLink(ev.event.series)} ·
        <a href="${esc(apiMarketUrl(ev.top.ticker))}" target="_blank" rel="noopener" title="API record for this contract">API</a>
      </td></tr>`);
    // contracts belonging to the event, biggest first
    for (const m of ev.markets.sort((a, b) => (Number(b.volume_fp) || 0) - (Number(a.volume_fp) || 0)).slice(0, 6)) {
      const mv = sessionMove(m);
      const d2 = mv == null ? "flat" : mv > 0 ? "up" : mv < 0 ? "down" : "flat";
      rows.push(`<tr class="clickable ${m.ticker === state.selected ? "selected" : ""}" data-pick="${esc(m.ticker)}">
        <td style="padding-left:26px"><span class="dim">↳</span> ${esc(shortTitle(m))} <span class="dim mono">${esc(m.ticker)}</span></td>
        <td class="num">${fmtNum(m.open_interest_fp)}</td>
        <td class="num">${fmt$((Number(m.volume_fp) || 0) * (lastPrice(m) || 0))}</td>
        <td class="num">${fmtNum(m.volume_fp)}</td>
        <td class="num">${fmtPx(lastPrice(m))}</td>
        <td class="num ${d2}">${mv == null ? "—" : fmtDelta(mv)}</td>
        <td class="nowrap">${esc(until(m.close_time))}</td>
        <td class="nowrap"><a href="${esc(apiMarketUrl(m.ticker))}" target="_blank" rel="noopener">API</a></td>
      </tr>`);
    }
  }
  body.innerHTML = rows.join("");
  body.querySelectorAll("[data-pick]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    select(tr.dataset.pick);
  }));
}

function shortTitle(m) {
  if (!m) return "—";
  const t = m.yes_sub_title || m.title || m.ticker;
  return t.length > 48 ? t.slice(0, 47) + "…" : t;
}

function sessionMove(m) {
  const open = state.sessionOpen.get(m?.ticker);
  const now = lastPrice(m);
  if (open == null || now == null) return null;
  return now - open;
}

function seriesLink(seriesTicker) {
  const url = kalshiSeriesUrl(seriesTicker);
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Kalshi market page">Kalshi ↗</a>`
    : `<span class="dim">—</span>`;
}

// ---------------------------------------------------------------------------
// selection + detail panel
// ---------------------------------------------------------------------------
/** The ticker in location.hash, if any. */
function hashTicker() {
  try {
    const raw = decodeURIComponent(String(location.hash || "").replace(/^#/, "")).trim();
    return raw || null;
  } catch { return null; }
}

/** Adopt the hash selection when that contract is in the current snapshot. */
function selectFromHash() {
  const t = hashTicker();
  if (!t || !state.markets.some((m) => m.ticker === t)) return false;
  state.selected = t;
  return true;
}

function select(ticker) {
  state.selected = ticker;
  if (ticker && hashTicker() !== ticker) {
    try { history.replaceState(null, "", "#" + encodeURIComponent(ticker)); } catch { /* file:// */ }
  }
  state.book = null;
  renderEvents();
  renderDetail();
  drawChart(true);
  // Not every engine implements smooth scrolling; never let that break selection.
  const card = $("detail-card");
  if (card && typeof card.scrollIntoView === "function") {
    try { card.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { card.scrollIntoView(); }
  }
}

function selectedMarket() {
  return state.markets.find((m) => m.ticker === state.selected) || null;
}

async function renderDetail() {
  const m = selectedMarket();
  if (!m) {
    $("detail-title").textContent = "Select a contract";
    return;
  }
  const topic = TOPIC_BY_ID[m._topic];
  $("detail-title").innerHTML = `${esc(m.title || m.ticker)} <span class="pill">${esc(topic?.label || m._topic)}</span>`;
  $("detail-sub").innerHTML = `${esc(m._eventTitle || "")} <span class="dim">· ${esc(m.ticker)}</span>`;
  $("d-price").textContent = fmtPx(lastPrice(m));
  $("d-quote").textContent = `${fmtPx(yesBid(m))} / ${fmtPx(yesAsk(m))}`;
  $("d-close").textContent = until(m.close_time);
  $("f-ticker").innerHTML = `<code>${esc(m.ticker)}</code>`;
  $("f-event").innerHTML = `${esc(m._eventTitle || "—")}<div class="dim mono">${esc(m.event_ticker)}</div>`;
  const s = state.seriesInfo.get(m._series);
  $("f-series").innerHTML = `${esc(s?.title || "—")}<div class="dim mono">${esc(m._series || "")}</div>`;
  $("f-category").textContent = m._category || "—";
  $("f-volume").textContent = fmtNum(m.volume_fp);
  $("f-oi").textContent = fmtNum(m.open_interest_fp);
  $("f-settle").innerHTML = s?.settlement
    ? `<a href="${esc(s.settlement.url)}" target="_blank" rel="noopener">${esc(s.settlement.name || "source")}</a>`
    : `<span class="dim">not published by the API for this series</span>`;
  $("f-links").innerHTML = [
    seriesLink(m._series),
    `<a href="${esc(apiMarketUrl(m.ticker))}" target="_blank" rel="noopener">API market</a>`,
    `<a href="${esc(`https://kalshi.com/markets/${String(m._series || "").toLowerCase()}`)}" target="_blank" rel="noopener">Kalshi page</a>`,
  ].join(" · ");
  $("f-rules").textContent = m.rules_primary ? `Rule: ${m.rules_primary.slice(0, 320)}` : "";
  await loadBook(m.ticker);
}

async function loadBook(ticker) {
  try {
    const ob = await fetchOrderbook(ticker, 15);
    state.book = ob;
    renderBook(ob);
    const d = bookDepth(ob);
    $("d-depth").textContent = fmtNum(d.total);
  } catch (e) {
    $("book-body").innerHTML = `<tr><td colspan="5" class="muted">Order book unavailable (${esc(e.message)}).</td></tr>`;
    $("d-depth").textContent = "—";
  }
}

function renderBook(ob) {
  const rows = [];
  const side = (arr, label, dir) => {
    const levels = (arr || []).map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q));
    levels.sort((a, b) => b[0] - a[0]);              // best price first
    let cum = 0;
    const max = levels.reduce((a, [, q]) => Math.max(a, q), 0) || 1;
    for (const [p, q] of levels) {
      cum += q;
      rows.push(`<tr>
        <td class="${dir}">${label}</td>
        <td class="num">${fmtPx(p)}</td>
        <td class="num">${fmtNum(q)}</td>
        <td class="num dim">${fmtNum(cum)}</td>
        <td><div class="bar"><i style="width:${Math.max(4, (q / max) * 100)}%;background:${dir === "up" ? "var(--green)" : "var(--red)"}"></i></div></td>
      </tr>`);
    }
  };
  side(ob.yes_dollars, "YES bid", "up");
  side(ob.no_dollars, "NO bid", "down");
  $("book-body").innerHTML = rows.join("") || `<tr><td colspan="5" class="muted">Empty book — no resting orders on either side right now.</td></tr>`;
}

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------
async function drawChart(reset = false) {
  const cv = $("chart");
  if (!cv) return;
  const m = selectedMarket();
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = (cv.width = cv.clientWidth * dpr);
  const H = (cv.height = cv.clientHeight * dpr);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#93a4c6";
  ctx.font = `${11 * dpr}px ui-monospace, monospace`;
  if (!m) { ctx.fillText("Select a contract above to plot its price.", 12 * dpr, 24 * dpr); return; }

  const now = Date.now();
  const startTs = now - state.windowSec * 1000;

  // candlesticks for the window (cached briefly so tab switching is instant)
  const key = `${state.selected}:${state.windowSec}`;
  const cached = state.candleCache.get(key);
  let candles = [];
  if (cached && Date.now() - cached.at < 30000 && !reset) {
    candles = cached.points;
  } else {
    const plan = candlePlan(state.windowSec);
    try {
      candles = await fetchCandles(m._series, m.ticker, Math.floor(startTs / 1000), Math.floor(now / 1000), plan.interval);
      state.candleCache.set(key, { at: Date.now(), points: candles });
    } catch (e) {
      candles = cached?.points || [];
    }
  }

  // Build the series: candle closes (trade price), plus live poll points.
  const pts = [];
  for (const c of candles) {
    const px = Number(c.price?.close_dollars);
    if (Number.isFinite(px)) pts.push({ ts: c.end_period_ts * 1000, price: px, o: Number(c.price?.open_dollars), h: Number(c.price?.high_dollars), l: Number(c.price?.low_dollars) });
  }
  const live = (state.history.get(m.ticker) || []).filter((p) => p.ts >= startTs);
  for (const p of live) if (!pts.length || p.ts > pts[pts.length - 1].ts) pts.push(p);
  pts.sort((a, b) => a.ts - b.ts);

  const padL = 46 * dpr, padR = 14 * dpr, padT = 14 * dpr, padB = 26 * dpr;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const t0 = startTs, t1 = Math.max(now, pts.length ? pts[pts.length - 1].ts : now);
  const x = (ts) => padL + plotW * ((ts - t0) / Math.max(1, t1 - t0));
  const y = (p) => padT + plotH * (1 - Math.min(1, Math.max(0, p)));

  // grid + axes
  ctx.strokeStyle = "#1b2536"; ctx.lineWidth = 1 * dpr;
  ctx.fillStyle = "#93a4c6";
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const yy = y(p);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText("$" + p.toFixed(2), 6 * dpr, yy + 3.5 * dpr);
  }
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const ts = t0 + ((t1 - t0) * i) / ticks;
    const xx = x(ts);
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, H - padB); ctx.stroke();
    const label = state.windowSec <= 3600
      ? new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: state.windowSec <= 300 ? "2-digit" : undefined })
      : new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    ctx.fillText(label, xx - 22 * dpr, H - 8 * dpr);
  }

  if (pts.length < 2) {
    ctx.fillStyle = "#93a4c6";
    ctx.fillText("No trade prints in this window yet — switch to a longer window or wait for the next trades.", 12 * dpr, H / 2);
    $("chart-info").textContent = `${m.ticker} · ${candles.length} candles · no usable prints`;
    return;
  }

  // price line
  ctx.strokeStyle = "#22e6a4"; ctx.lineWidth = 1.6 * dpr; ctx.beginPath();
  pts.forEach((p, i) => { const px = x(p.ts), py = y(p.price); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();

  // candle bodies where OHLC is available
  ctx.globalAlpha = 0.5;
  for (const p of pts) {
    if (!Number.isFinite(p.o) || !Number.isFinite(p.h) || !Number.isFinite(p.l)) continue;
    const up = p.price >= p.o;
    ctx.strokeStyle = up ? "#22e6a4" : "#ff5c7a";
    ctx.fillStyle = ctx.strokeStyle;
    const xx = x(p.ts);
    ctx.beginPath(); ctx.moveTo(xx, y(p.h)); ctx.lineTo(xx, y(p.l)); ctx.stroke();
    const bw = Math.max(1.5 * dpr, Math.min(6 * dpr, plotW / Math.max(20, pts.length) * 0.6));
    ctx.fillRect(xx - bw / 2, y(Math.max(p.o, p.price)), bw, Math.max(1, Math.abs(y(p.o) - y(p.price))));
  }
  ctx.globalAlpha = 1;

  // ≥ $0.10 step markers
  ctx.fillStyle = "#ffb347";
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].price - pts[i - 1].price) >= ALERT_THRESHOLD - 1e-9) {
      ctx.beginPath(); ctx.arc(x(pts[i].ts), y(pts[i].price), 3.4 * dpr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // current price marker + label
  const last = pts[pts.length - 1];
  ctx.fillStyle = "#22e6a4";
  ctx.beginPath(); ctx.arc(x(last.ts), y(last.price), 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e9eefb";
  ctx.font = `600 ${12 * dpr}px ui-monospace, monospace`;
  ctx.fillText(fmtPx(last.price), Math.min(W - padR - 46 * dpr, x(last.ts) + 6 * dpr), Math.max(padT + 10 * dpr, y(last.price) - 6 * dpr));

  $("chart-info").textContent =
    `${pts.length} points · ${candles.length} candles (${candlePlan(state.windowSec).interval}-min bars) · window ${labelWindow(state.windowSec)} · last ${fmtPx(last.price)} at ${timeStr(last.ts)}`;
}

function labelWindow(s) {
  return s < 3600 ? `${s / 60} min` : s < 86400 ? `${s / 3600} h` : `${s / 86400} d`;
}

// ---------------------------------------------------------------------------
// resolutions
// ---------------------------------------------------------------------------
async function refreshResolutions(manual = false) {
  const topics = state.topic === "all" ? TOPICS : [TOPIC_BY_ID[state.topic]];
  const seriesSet = new Set();
  for (const t of topics) {
    const info = [...state.seriesInfo.values()].filter((s) => !s.topic || s.topic === t.id);
    for (const s of info.slice(0, 8)) seriesSet.add(s.ticker);
  }
  // Fall back to the verified snapshot's tickers so this works before any live data lands.
  if (!seriesSet.size) {
    try {
      const v = await loadVerified();
      for (const t of topics) for (const s of (v?.[t.id]?.series || []).slice(0, 8)) seriesSet.add(s.ticker);
    } catch { /* nothing to show */ }
  }
  const out = [];
  for (const s of [...seriesSet].slice(0, 12)) {
    try {
      const rows = await fetchSettled(s, 8);
      for (const m of rows) out.push({ ...m, _series: s });
    } catch { /* skip */ }
  }
  out.sort((a, b) => String(b.close_time || "").localeCompare(String(a.close_time || "")));
  state.resolved = out.slice(0, 40);
  renderResolutions();
  settlePaperTrades();
  if (manual) toast(`Re-checked ${seriesSet.size} series for settlements.`);
}

function renderResolutions() {
  const body = $("res-body");
  if (!body) return;
  body.innerHTML = state.resolved.map((m) => {
    const r = (m.result || "").toLowerCase();
    const cls = r === "yes" ? "up" : r === "no" ? "down" : "flat";
    const trade = state.paper.find((t) => t.ticker === m.ticker);
    return `<tr>
      <td class="nowrap">${esc(clockStr(m.close_time))}</td>
      <td><span class="mono">${esc(m.ticker)}</span><div class="dim">${esc(shortTitle(m))}</div></td>
      <td>${esc(m.event_ticker || "—")}</td>
      <td class="${cls}"><b>${r ? r.toUpperCase() : "—"}</b></td>
      <td class="num">${fmtPx(lastPrice(m))}</td>
      <td>${trade ? `${esc(trade.side)} @ ${fmtPx(trade.entry)} ${trade.pnl == null ? "" : `<span class="${trade.pnl >= 0 ? "up" : "down"}">${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}</span>`}` : `<span class="dim">—</span>`}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No settled contracts returned for the series in view. Demo markets often stay open for days; check back or widen the topic.</td></tr>`;
  $("res-count").textContent = state.resolved.length;
}

// ---------------------------------------------------------------------------
// paper trading (simulated; the Portfolio page does the analysis)
// ---------------------------------------------------------------------------
function openPaperTrade(alert, market) {
  if (state.paper.some((t) => t.ticker === alert.ticker && t.exit == null)) return;
  const side = alert.delta >= 0 ? "yes" : "no";
  const ask = side === "yes" ? yesAsk(market) : (yesBid(market) != null ? 1 - yesBid(market) : null);
  const entry = ask ?? (side === "yes" ? lastPrice(market) : 1 - lastPrice(market));
  if (entry == null || entry <= 0 || entry >= 1) return;
  state.paper.push({
    ticker: alert.ticker, topic: alert.topic, event: alert.event, series: alert.series,
    title: alert.title, side, entry, contracts: 10, ts: alert.ts,
    strategy: "swing-momentum + ROI screen", exit: null, pnl: null,
  });
  savePaper();
}

function savePaper() {
  store.set("paper", state.paper.slice(-400));
}

function renderPaper() {
  const body = $("paper-body");
  if (!body) return;
  const open = state.paper.filter((t) => t.exit == null).slice(-15).reverse();
  body.innerHTML = open.map((t) => {
    const m = state.markets.find((x) => x.ticker === t.ticker);
    const now = m ? lastPrice(m) : null;
    const markSide = now == null ? null : (t.side === "yes" ? now : 1 - now);
    const unreal = markSide == null ? null : (markSide - t.entry) * t.contracts;
    return `<tr class="clickable" data-pick="${esc(t.ticker)}">
      <td class="nowrap">${timeStr(t.ts)}</td>
      <td><span class="mono">${esc(t.ticker)}</span><div class="dim">${esc(t.title || "")}</div></td>
      <td>${esc(TOPIC_BY_ID[t.topic]?.label || t.topic || "—")}</td>
      <td class="${t.side === "yes" ? "up" : "down"}">${esc(t.side.toUpperCase())}</td>
      <td class="num">${fmtPx(t.entry)}</td>
      <td class="num">${markSide == null ? "—" : fmtPx(markSide)}</td>
      <td class="num ${unreal == null ? "" : unreal >= 0 ? "up" : "down"}">${unreal == null ? "—" : (unreal >= 0 ? "+" : "") + unreal.toFixed(2)}</td>
      <td><span class="pill">open</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">No simulated trades yet — they open automatically when a swing passes the high-ROI screen.</td></tr>`;
  body.querySelectorAll("[data-pick]").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.pick)));
}

function settlePaperTrades() {
  let changed = false;
  for (const t of state.paper) {
    if (t.exit != null) continue;
    const m = state.resolved.find((x) => x.ticker === t.ticker);
    const r = (m?.result || "").toLowerCase();
    if (r !== "yes" && r !== "no") continue;
    const payout = r === "yes" ? 1 : 0;
    t.exit = t.side === "yes" ? payout : 1 - payout;
    t.result = r;
    t.pnl = (t.exit - t.entry) * t.contracts;
    t.roi = t.entry > 0 ? (t.exit - t.entry) / t.entry : null;
    changed = true;
  }
  if (changed) { savePaper(); renderPaper(); }
}

// ---------------------------------------------------------------------------
// misc UI
// ---------------------------------------------------------------------------
function setStatus(text, kind = "info") {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.className = "pill " + (kind === "live" ? "live" : kind === "bad" ? "bad" : kind === "warn" ? "warn" : "info");
}

let toastTimer = null;
function toast(msg, ms = 4000) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hide"), ms);
}

let audioCtx = null;
function beep(vol = 0.06) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.12);
  } catch { /* audio blocked — ignore */ }
}

// Rendering smoke test: runs the real page scripts against recorded Kalshi
// response shapes (taken from the official docs and live demo responses) inside
// jsdom, then asserts the dashboard, portfolio and topic pages actually render.
//
// Skips cleanly when jsdom is not installed, so the repo stays dependency-free
// for casual use; CI installs jsdom before running it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("SKIP render test: jsdom not installed (npm i --no-save jsdom)");
  process.exit(0);
}

const DOCS = path.resolve("docs");
const results = [];
let failures = 0;

// Each page is booted in its own process: a browser gives every document its own
// globals, and jsdom cannot reset module scope between pages.
const only = (process.argv.find((a) => a.startsWith("--page=")) || "").split("=")[1];
const CASES = [
  ["dashboard", "dashboard.html", "dashboard.js", 1400],
  ["portfolio", "portfolio.html", "portfolio.js", 1400],
  ["golf", "topics/golf.html", "topic.js", 1200],
  ["deeplink", "dashboard.html", "dashboard.js", 1400],
];
if (!only) {
  let bad = 0;
  for (const [key, page, script] of [...CASES.map((c) => [c[0], c[1], c[2]]),
    ...[["index", "index.html", ""], ["exec", "executive-summary.html", ""],
        ["methodology", "methodology.html", "methodology.js"],
        ["verification", "verification.html", "verification.js"],
        ["flagged", "flagged.html", ""], ["dashboard-phone", "dashboard.html", "dashboard.js"]]]) {
    const extra = key === "dashboard-phone" ? ["--narrow"] : [];
    const r = spawnSync(process.execPath, [process.argv[1], `--page=${key}`,
      `--html=${page}`, ...(script ? [`--js=${script}`] : []), ...extra], { encoding: "utf8" });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}

// ---- fixtures: real field names and value types from the Kalshi demo API ----
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const EVENTS = [
  { event_ticker: "KXETHD-26NOV2009", category: "Crypto", series_ticker: "KXETHD", title: "ETH price today at 9am EST?", sub_title: "9am" },
  { event_ticker: "KXAAAGASM-26NOV30", category: "Economics", series_ticker: "KXAAAGASM", title: "Gas prices in the US this month?", sub_title: "Nov" },
  { event_ticker: "KXPGATOUR-THRC26", category: "Sports", series_ticker: "KXPGATOUR", title: "The RSM Classic Winner", sub_title: "1 of 1" },
  { event_ticker: "KXTOPARTIST-26", category: "Entertainment", series_ticker: "KXTOPARTIST", title: "Top Artist on Spotify", sub_title: "2026" },
  { event_ticker: "KXIATREASR-26", category: "Elections", series_ticker: "KXIATREASR", title: "Iowa Treasurer winner", sub_title: "2026" },
];

const MARKET = (ticker, event, over = {}) => ({
  ticker, event_ticker: event, series_ticker: event.split("-")[0],
  title: `${event} ${ticker}`, yes_sub_title: ticker.slice(-6),
  last_price_dollars: "0.5800", previous_price_dollars: "0.4400",
  yes_bid_dollars: "0.5600", yes_ask_dollars: "0.6000",
  no_bid_dollars: "0.4000", no_ask_dollars: "0.4400",
  volume_fp: "1200.00", volume_24h_fp: "300.00", open_interest_fp: "340.00",
  close_time: iso(NOW + 36 * 3600 * 1000), status: "active", result: "",
  rules_primary: "Resolves YES if the settlement value meets the strike.",
  ...over,
});

// The fixture market repriced between poll cycles, so the dashboard's own
// snapshot-diffing has something real to detect (a +14c move, both sides).
let marketsCall = 0;
const MARKETS = [
  MARKET("KXETHD-26NOV2009-B1735", "KXETHD-26NOV2009"),
  MARKET("KXETHD-26NOV2009-B1740", "KXETHD-26NOV2009", { last_price_dollars: "0.2100", yes_bid_dollars: "0.2000", yes_ask_dollars: "0.2300" }),
  MARKET("KXAAAGASM-26NOV30-A350", "KXAAAGASM-26NOV30", { last_price_dollars: "0.5000" }),
  MARKET("KXPGATOUR-THRC26-THOR", "KXPGATOUR-THRC26", { last_price_dollars: "0.7200" }),
  MARKET("KXTOPARTIST-26-TAYL", "KXTOPARTIST-26", { last_price_dollars: "0.3100" }),
  MARKET("KXIATREASR-26-SMITH", "KXIATREASR-26", { last_price_dollars: "0.6400" }),
  // outside the five topics: must never appear
  MARKET("KXBTCD-26NOV2009-B60000", "KXBTCD-26NOV2009"),
];

const SERIES = {
  KXETHD: { ticker: "KXETHD", title: "Ethereum price Above/below", category: "Crypto", categories: ["Crypto"], tags: ["Crypto", "Ethereum"], frequency: "hourly", settlement_sources: [{ name: "CF Benchmarks", url: "https://www.cfbenchmarks.com/data/indices/ETHUSD_RTI" }] },
  KXAAAGASM: { ticker: "KXAAAGASM", title: "US gas price", category: "Economics", categories: ["Economics"], tags: ["Oil & Gas", "Oil and energy"], frequency: "monthly", settlement_sources: [{ name: "AAA", url: "https://gasprices.aaa.com/" }] },
  KXPGATOUR: { ticker: "KXPGATOUR", title: "PGA Tour winner", category: "Sports", categories: ["Sports"], tags: ["Golf"], frequency: "custom", settlement_sources: [{ name: "ESPN", url: "https://www.espn.com/" }] },
  KXTOPARTIST: { ticker: "KXTOPARTIST", title: "Top Artist on Spotify", category: "Entertainment", categories: ["Entertainment"], tags: ["Music"], frequency: "annual", settlement_sources: [{ name: "Spotify", url: "https://open.spotify.com/" }] },
  KXIATREASR: { ticker: "KXIATREASR", title: "Iowa Treasurer winner", category: "Elections", categories: ["Elections"], tags: ["US Elections"], frequency: "custom", settlement_sources: [{ name: "Iowa Secretary of State", url: "https://sos.iowa.gov/iowans/election-results-statistics" }] },
};

const ORDERBOOK = {
  orderbook_fp: {
    yes_dollars: [["0.0100", "200.00"], ["0.4200", "13.00"], ["0.5600", "40.00"]],
    no_dollars: [["0.0100", "100.00"], ["0.3800", "25.00"]],
  },
};

const CANDLES = {
  ticker: "KXETHD-26NOV2009-B1735",
  candlesticks: Array.from({ length: 40 }, (_, i) => ({
    end_period_ts: Math.floor((NOW - (39 - i) * 60000) / 1000),
    price: { open_dollars: "0.50", high_dollars: "0.62", low_dollars: "0.46", close_dollars: String((0.5 + i * 0.002).toFixed(4)) },
    yes_bid: { open_dollars: "0.5", high_dollars: "0.6", low_dollars: "0.45", close_dollars: "0.55" },
    yes_ask: { open_dollars: "0.55", high_dollars: "0.65", low_dollars: "0.5", close_dollars: "0.6" },
    volume_fp: "12.00", open_interest_fp: "40.00",
  })),
};

const SETTLED = {
  markets: [MARKET("KXPGATOUR-THRC26-THOR", "KXPGATOUR-THRC26", { status: "settled", result: "yes", last_price_dollars: "0.9800" })],
};

let requestLog = [];
const ALLOWED_BASES = [
  "https://external-api.demo.kalshi.co/trade-api/v2",
  "https://demo-api.kalshi.co/trade-api/v2",
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
];
function route(url, base) {
  // Every request must be absolute and must hit a documented API base. This
  // catches base-URL construction bugs, which would otherwise only show up as a
  // silently empty dashboard against the live API.
  if (!/^https:\/\//.test(url)) throw new Error(`not an absolute URL: ${url}`);
  const u = new URL(url, base || "http://kalshi.test/");
  if (!ALLOWED_BASES.some((b) => url.startsWith(b))) throw new Error(`unknown API base: ${url}`);
  const p = u.pathname.replace(/^.*\/trade-api\/v2/, "");
  requestLog.push(p + (u.search || ""));
  if (p === "/events") return { events: EVENTS, cursor: "" };
  if (p === "/markets") {
    const params = u.searchParams;
    if (params.get("status") === "settled") return SETTLED;
    if (params.get("series_ticker")) {
      return { markets: MARKETS.filter((m) => m.event_ticker.startsWith(params.get("series_ticker"))), cursor: "" };
    }
    marketsCall++;
    if (marketsCall === 1) return { markets: MARKETS, cursor: "" };
    return {
      markets: MARKETS.map((m) => (m.ticker === "KXETHD-26NOV2009-B1735"
        ? { ...m, last_price_dollars: "0.7200", yes_bid_dollars: "0.7000", yes_ask_dollars: "0.7400" }
        : m)),
      cursor: "",
    };
  }
  if (p === "/series") {
    const cat = u.searchParams.get("category");
    const tag = u.searchParams.get("tags");
    const all = Object.values(SERIES).filter((s) => s.category === cat);
    const filtered = tag
      ? all.filter((s) => (s.tags || []).some((t) => t.toLowerCase().replace(/&/g, "and") === tag.toLowerCase().replace(/&/g, "and")))
      : all;
    return { series: filtered };
  }
  const m = p.match(/^\/series\/([^/]+)$/);
  if (m) return { series: SERIES[decodeURIComponent(m[1])] || {} };
  if (/\/orderbook$/.test(p)) return ORDERBOOK;
  if (/\/candlesticks$/.test(p)) return CANDLES;
  return {};
}

// ---- jsdom helpers ---------------------------------------------------------
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (_, k) => (k === "measureText" ? () => ({ width: 10 }) : noop), set: () => true });
}

async function boot({ page, script, viewportWidth = 1400, beforeEach } = {}) {
  const file = path.join(DOCS, page);
  const html = fs.readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: `http://kalshi.test/${page}`, pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  Object.defineProperty(window, "innerWidth", { value: viewportWidth, configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => makeCtx();
  window.fetch = async (url) => {
    const raw = String(url);
    if (/data\/series\.json$/.test(raw)) {
      const local = path.join(DOCS, "data/series.json");
      const body = JSON.parse(fs.readFileSync(local, "utf8"));
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    const body = route(raw, window.location.href);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  window.localStorage.clear();

  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e)));
  const rejections = [];
  process.on("unhandledRejection", (e) => rejections.push(String((e && e.stack) || e)));
  process.on("uncaughtException", (e) => rejections.push(String((e && e.stack) || e)));
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(" ")); };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.fetch = window.fetch;
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.devicePixelRatio = 1;
  // Browser globals a page script may reference without the `window.` prefix.
  for (const key of ["location", "history", "navigator", "requestAnimationFrame",
    "cancelAnimationFrame", "getComputedStyle", "Audio", "IntersectionObserver",
    "matchMedia", "scrollTo", "addEventListener", "removeEventListener"]) {
    if (window[key] === undefined) continue;
    try {
      const value = window[key];
      Object.defineProperty(globalThis, key, { value: typeof value === "function" && key.startsWith("add") ? value.bind(window) : value, configurable: true, writable: true });
    } catch { /* getter-only global */ }
  }
  globalThis.AudioContext = undefined;

  if (beforeEach) await beforeEach(window);

  // A browser runs deferred module scripts while the document is still "loading"
  // and only then fires DOMContentLoaded; jsdom would otherwise race us.
  let ready = "loading";
  Object.defineProperty(window.document, "readyState", { get: () => ready, configurable: true });

  let mod = null;
  if (script) mod = await import(pathToFileURL(path.join(DOCS, "assets", script)).href + `?v=${Date.now()}-${page}`);
  await wait(30);
  ready = "interactive";
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  ready = "complete";
  // Wait until the page has finished its first data cycle (paced requests take time).
  for (let i = 0; i < 80; i++) {
    await wait(100);
    const st = window.document.getElementById("status");
    const txt = st ? st.textContent : "";
    if (txt && !/Connecting|Refreshing/i.test(txt)) break;
  }
  await wait(200);
  console.error = origError;
  if (rejections.length) errors.push("unhandled: " + rejections.join(" | "));
  return { window, doc: window.document, errors, mod };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- dashboard ------------------------------------------------------------
if (only === "deeplink") {
  const TARGET = "KXPGATOUR-THRC26-THOR";
  const { doc, errors } = await boot({
    page: "dashboard.html", script: "dashboard.js",
    beforeEach: (w) => { w.location.hash = "#" + TARGET; },
  });
  check("deep link: no runtime errors", () => assert(errors.length === 0, errors.join(" | ")));
  check(`deep link: #${TARGET} opens that contract`, () => {
    const sub = text(doc.getElementById("detail-sub"));
    assert(sub.includes(TARGET), `detail panel shows: ${sub}`);
  });
  check("deep link: chart and book follow the selection", () => {
    assert(/candle/i.test(text(doc.getElementById("chart-info"))), "no chart series loaded");
    assert(text(doc.getElementById("book-body")).length > 10, "no order book");
  });
  check("deep link: clicking another contract updates the hash", async () => {
    const row = doc.querySelector('#events-body [data-pick]');
    assert(row, "no clickable contract row");
    row.click();
    assert(doc.location.hash === "#" + row.dataset.pick,
      `hash is ${doc.location.hash}, expected #${row.dataset.pick}`);
  });
}

if (only === "dashboard" || only === "dashboard-phone") {
  const narrow = process.argv.includes("--narrow");
  const { doc, errors } = await boot({
    page: "dashboard.html", script: "dashboard.js", viewportWidth: narrow ? 420 : 1400,
  });
  // A second poll cycle: swings are detected by comparing consecutive snapshots,
  // exactly as a browser tab would after one refresh interval.
  doc.getElementById("refresh-btn").click();
  await wait(600);
  if (process.env.DEBUG_RENDER) {
    console.log("requests:", requestLog.join("\n  "));
    console.log("status:", text(doc.getElementById("status")));
    console.log("tabs:", text(doc.getElementById("topic-tabs")));
  }
  check("dashboard: no runtime errors", () => assert(errors.length === 0, errors.join(" | ")));
  check("dashboard: connection status reports live", () =>
    assert(/live/i.test(text(doc.getElementById("status"))), text(doc.getElementById("status"))));
  check("dashboard: KPI counts only in-scope contracts", () => {
    const n = Number(text(doc.getElementById("kpi-markets")));
    assert(n === 6, `expected 6 in-scope contracts (7 fixtures, 1 out of scope), got ${n}`);
  });
  check("dashboard: a crypto market whose series is not mapped is excluded", () => {
    assert(!text(doc.getElementById("events-body")).includes("KXBTCD"),
      "KXBTCD should not appear: its series is absent from the topic map");
  });
  check("dashboard: events table grouped by topic", () => {
    const body = text(doc.getElementById("events-body"));
    for (const label of ["Crypto", "Gas prices", "Golf", "Culture", "Elections"]) {
      assert(body.includes(label), `missing topic group ${label}`);
    }
  });
  check("dashboard: the ≥ $0.10 move raised an alert", () => {
    const chat = text(doc.getElementById("chat-all"));
    assert(chat.includes("KXETHD"), chat.slice(0, 200));
    assert(/14¢|\$0\.14/.test(chat), `alert should quantify the move: ${chat.slice(0, 200)}`);
  });
  check("dashboard: the swing that passes the screen lands in the high-ROI feed", () => {
    const chat = text(doc.getElementById("chat-roi"));
    assert(/KXETHD/.test(chat), `ROI chat should carry the screened alert: ${chat.slice(0, 200)}`);
    assert(/\+14¢|\$0\.14/.test(chat), `ROI chat should quantify the move: ${chat.slice(0, 200)}`);
  });
  check("dashboard: an alert auto-opens a simulated trade", () => {
    const paper = text(doc.getElementById("paper-body"));
    assert(/KXETHD/.test(paper), `paper blotter empty: ${paper.slice(0, 200)}`);
  });
  check("dashboard: order book shows both sides with counts", () => {
    const book = text(doc.getElementById("book-body"));
    assert(book.includes("YES") && book.includes("NO"), book.slice(0, 160));
    assert(/0?\.56/.test(book), "best YES bid missing");
  });
  check("dashboard: chart fetched candles and drew them", () => {
    const info = text(doc.getElementById("chart-info"));
    assert(/candle/i.test(info), `chart-info: ${info}`);
  });
  check("dashboard: contract facts cite the settlement source", () => {
    assert(doc.getElementById("f-settle"), "no settlement field");
    assert(/cfbenchmarks|aaa|espn|spotify|iowa/i.test(doc.body.textContent),
      "no settlement source URL rendered anywhere on the page");
  });
  check("dashboard: resolution tracker uses the exchange result", () => {
    const res = text(doc.getElementById("res-body"));
    assert(/YES|settled/i.test(res), res);
  });
  check("dashboard: requests exclude multivariate combos", () =>
    assert(requestLog.some((r) => r.includes("mve_filter=exclude")), "no mve_filter=exclude on a /markets call"));
  if (narrow) {
    check("dashboard (phone): still renders the alert feed", () =>
      assert(text(doc.getElementById("chat-all")).length > 20, "empty alert feed at 420px"));
  }
}

// ---- portfolio ------------------------------------------------------------
if (only === "portfolio") {
  const { doc, errors } = await boot({ page: "portfolio.html", script: "portfolio.js" });
  check("portfolio: no runtime errors", () => assert(errors.length === 0, errors.join(" | ")));
  check("portfolio: all four strategies compared", () => {
    const rows = [...doc.querySelectorAll("#cmp-body tr")];
    assert(rows.length === 4, `expected 4 strategy rows, got ${rows.length}`);
  });
  check("portfolio: blotter populated", () =>
    assert([...doc.querySelectorAll("#blotter-body tr")].length > 0, "no blotter rows"));
  check("portfolio: settled trade takes the exchange result", () =>
    assert(/YES/.test(text(doc.getElementById("blotter-body"))), text(doc.getElementById("blotter-body")).slice(0, 200)));
  check("portfolio: P&L is broken down by category", () =>
    assert([...doc.querySelectorAll("#cat-body tr")].length > 0, "no category rows"));
  check("portfolio: run status finished without an error", () => {
    const status = text(doc.getElementById("run-status"));
    assert(!/failed/i.test(status), status);
  });
}

// ---- a topic page ---------------------------------------------------------
if (only === "golf") {
  const { doc, errors } = await boot({ page: "topics/golf.html", script: "topic.js" });
  check("golf: no runtime errors", () => assert(errors.length === 0, errors.join(" | ")));
  check("golf: every verified row carries its API proof link", () => {
    const rows = [...doc.querySelectorAll("#series-body tr")];
    assert(rows.length >= 4, `expected the 4 verified golf rows, got ${rows.length}`);
    assert(rows.every((r) => r.querySelector("a[href*='/series/']")), "a row has no /series/ link");
  });
  check("golf: live table stays inside the topic", () => {
    const body = text(doc.getElementById("live-body"));
    assert(body.includes("KXPGATOUR"), body.slice(0, 120));
    assert(!body.includes("KXETHD"), "crypto leaked into the golf page");
  });
}

// ---- static documentation pages ------------------------------------------
const STATIC_PAGES = {
  index: ["index.html"], exec: ["executive-summary.html"],
  methodology: ["methodology.html", "methodology.js"],
  verification: ["verification.html", "verification.js"],
  flagged: ["flagged.html"],
};
if (STATIC_PAGES[only]) {
  const [htmlFile, js] = STATIC_PAGES[only];
  const { doc, errors } = await boot({ page: htmlFile, script: js || "" });
  check(`${htmlFile}: renders`, () => {
    assert(errors.length === 0, errors.join(" | "));
    assert(doc.title.length > 5, "missing <title>");
    assert(doc.querySelectorAll("table tr").length > 1, "no table content");
    assert(doc.querySelectorAll("a[href^='http']").length > 0, "no outbound source links");
  });
  if (only === "verification") {
    check("verification.html: row table populated from series.json", () =>
      assert(doc.querySelectorAll("tbody tr").length >= 30, "fewer than 30 evidence rows"));
  }
}

console.log(results.join("\n"));
if (failures) console.log(`${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

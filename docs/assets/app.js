// Shared site config + helpers. No external dependencies.
export const DEMO_BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
export const PROD_BASE = "https://external-api.kalshi.com/trade-api/v2";
export const DEMO_WS = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2";
export const PROD_WS = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";
export const ALERT_THRESHOLD = 0.10; // $ swing that triggers an alert

export const TOPICS = [
  { id: "gas", label: "Gas prices", category: "Economics", tags: ["Oil & Gas", "Oil and energy"] },
  { id: "elections", label: "Elections", category: "Elections", tags: [] },
  { id: "culture", label: "Culture", category: "Culture", tags: [], note: "Kalshi's Culture category has 2 series and no markets at capture (verified 2026-11-20). Entertainment is NOT included by default (flag F15)." },
  { id: "crypto", label: "Crypto", category: "Crypto", tags: [] },
  { id: "golf", label: "Golf", category: "Sports", tags: ["Golf"] },
];

export function getBase() {
  return localStorage.getItem("kalshi-base") || DEMO_BASE;
}
export function setBase(b) { localStorage.setItem("kalshi-base", b); }

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${getBase()}${path}${qs ? "?" + qs : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export function dollarVolume(m) {
  const vol = parseFloat(m.volume_fp || "0") || 0;
  const px = parseFloat(m.last_price_dollars || "0") || 0;
  return vol * px;
}
export function lastPrice(m) {
  const p = parseFloat(m.last_price_dollars);
  if (!isNaN(p)) return p;
  const b = parseFloat(m.yes_bid_dollars);
  return isNaN(b) ? 0 : b;
}
export function fmt$(n) {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function fmtPx(p) { return p == null || isNaN(p) ? "—" : "$" + Number(p).toFixed(2); }
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function kalshiMarketUrl(ticker) {
  // Kalshi market pages are keyed by series slug; link to the market ticker search.
  // The canonical per-market URL is https://kalshi.com/markets/<series-slug>/<event-slug>
  // which requires series/event slugs, so we link to the API record instead (verified).
  return `${getBase()}/markets/${encodeURIComponent(ticker)}`;
}
export function timeStr(ts) { return new Date(ts).toLocaleTimeString(); }

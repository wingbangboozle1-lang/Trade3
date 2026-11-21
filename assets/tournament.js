// ============================================================================
// Strategy tournament page.
//
// The shadow books live on the collector (server/tournament.js) because they need
// a single, shared, continuously-updated ledger. This page reads them over the
// same-origin API and keeps them fresh over the same /live socket the dashboard
// uses. When the page is opened as a static file (GitHub Pages) there is no
// collector, so the page says exactly that and renders nothing rather than
// showing an empty scoreboard that could be mistaken for "no strategy is winning".
// ============================================================================

import { LiveRelay, relayUrl, RELAY_STATE } from "./live.js";

const $ = (id) => document.getElementById(id);
const TOPIC_LABEL = { gas: "Gas prices", elections: "Elections", culture: "Culture", crypto: "Crypto", golf: "Golf" };
const STRATEGY_ORDER = ["momentum", "mean_revert", "threshold_break", "fade_extreme"];

const state = {
  report: null,
  trades: [],
  relay: null,
  relayState: "idle",
  onlySettled: false,
  loadedAt: null,
  error: null,
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (cents) => (cents == null ? "" : (cents < 0 ? "−" : "") + "$" + (Math.abs(cents) / 100).toFixed(2));
const pct = (v) => (v == null ? "" : (v * 100).toFixed(0) + "%");
const num = (v) => (v == null ? "" : Number(v).toLocaleString());
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

document.addEventListener("DOMContentLoaded", () => {
  $("only-settled").addEventListener("change", (e) => { state.onlySettled = e.target.checked; renderPositions(); });
  $("download").addEventListener("click", downloadCsv);
  startRelay();
  load();
});

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------
function startRelay() {
  const url = relayUrl(location);
  const relay = new LiveRelay({ url });
  state.relay = relay;
  relay.on("state", ({ state: st }) => {
    state.relayState = st;
    renderStatus();
    // Once the socket is up, read once so the page is not blank while it waits
    // for the next collector tick.
    if (st === "open") load();
  });
  relay.on("message", (frame) => {
    if (!frame) return;
    if (frame.type === "trade" || frame.type === "alert" || frame.type === "update") load();
  });
  relay.start();
  renderStatus();
}

function renderStatus() {
  const pill = $("tourney-status");
  const tone = RELAY_STATE[state.relayState]?.tone || "info";
  pill.className = `pill ${tone}`;
  if (state.relayState === "open") {
    pill.textContent = state.error ? "relay live · load failed" : "relay live";
  } else if (state.relayState === "unavailable") {
    pill.textContent = "no collector on this origin";
  } else {
    pill.textContent = RELAY_STATE[state.relayState]?.label || state.relayState;
  }
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
async function load() {
  try {
    const r = await fetch("api/tournament", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    state.report = d.report || null;
    state.trades = d.trades || [];
    state.loadedAt = Date.now();
    state.error = null;
    renderAll();
  } catch (err) {
    state.error = err.message;
    state.report = null;
    state.trades = [];
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
function renderAll() {
  renderStatus();
  renderBoard();
  renderTopics();
  renderSides();
  renderSkips();
  renderPositions();
  renderNote();
}

function renderNote() {
  const note = $("tourney-note");
  const meta = $("tourney-meta");
  if (state.relayState === "unavailable") {
    note.innerHTML = `This page is being served as a static file, so there is no collector holding the
      shadow books — and a browser cannot hold them either, because four strategies sharing one ledger need
      one shared, always-on process. Nothing is displayed rather than a zeroed-out table that would look like
      "every strategy is flat". Run <code>npm start</code> in the repository and reload.`;
    meta.textContent = "";
    return;
  }
  if (state.error) {
    note.textContent = `Could not read the tournament ledger: ${state.error}. The table is left empty on purpose.`;
    meta.textContent = "";
    return;
  }
  if (!state.report) {
    note.textContent = "Waiting for the first read…";
    return;
  }
  const r = state.report;
  const when = state.loadedAt ? new Date(state.loadedAt).toLocaleTimeString() : "";
  meta.textContent = `${num(r.eventsSeen)} swings seen · ${num(r.openPositions)} open · read ${when}`;
  note.innerHTML = `${esc(r.note)} — ${esc(String(r.sizeCents / 100))} USD of notional per shadow trade.`;
}

function renderBoard() {
  const body = $("board-body");
  if (!state.report) {
    body.innerHTML = `<tr><td colspan="11" class="muted">${state.relayState === "unavailable"
      ? "No collector on this origin — run npm start to see the tournament."
      : "Loading…"}</td></tr>`;
    return;
  }
  const rows = [...state.report.strategies].sort(
    (a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  const rank = new Map(state.report.ranking.map((id, i) => [id, i + 1]));
  body.innerHTML = rows.map((s) => {
    const place = rank.get(s.strategy);
    const pnlClass = s.pnlCents == null ? "" : s.pnlCents > 0 ? "up" : s.pnlCents < 0 ? "down" : "";
    return `<tr>
      <td class="num">${place ? `<b>${place}</b>` : `<span class="dim">—</span>`}</td>
      <td><b>${esc(s.label)}</b><div class="dim">${esc(s.thesis)}</div></td>
      <td class="dim">${esc(s.rule)}</td>
      <td class="num">${num(s.eventsSeen)}</td>
      <td class="num">${num(s.opened)}</td>
      <td class="num ${s.skips ? "" : "dim"}">${num(s.skips)}</td>
      <td class="num">${num(s.settled)}</td>
      <td class="num">${s.wins || s.losses ? `${s.wins} / ${s.losses}` : `<span class="dim">—</span>`}</td>
      <td class="num">${pct(s.hitRate)}</td>
      <td class="num ${pnlClass}">${money(s.pnlCents)}</td>
      <td class="num">${s.avgPnlPerContractCents == null ? "" : s.avgPnlPerContractCents.toFixed(1)}</td>
    </tr>`;
  }).join("");
}

function renderTopics() {
  const body = $("topic-body");
  if (!state.report) { body.innerHTML = `<tr><td colspan="5" class="muted">—</td></tr>`; return; }
  const topics = Object.keys(TOPIC_LABEL);
  const byId = new Map(state.report.strategies.map((s) => [s.strategy, s]));
  body.innerHTML = topics.map((t) => {
    const cells = STRATEGY_ORDER.map((id) => {
      const n = byId.get(id)?.byTopic?.[t];
      return `<td class="num">${n ? num(n) : `<span class="dim">—</span>`}</td>`;
    }).join("");
    return `<tr><td>${esc(TOPIC_LABEL[t])}</td>${cells}</tr>`;
  }).join("") + `<tr><td class="dim">unclassified</td>${
    STRATEGY_ORDER.map((id) => {
      const n = byId.get(id)?.byTopic?.unknown;
      return `<td class="num ${n ? "" : "dim"}">${n ? num(n) : "—"}</td>`;
    }).join("")}</tr>`;
}

function renderSides() {
  const body = $("side-body");
  if (!state.report) { body.innerHTML = `<tr><td colspan="5" class="muted">—</td></tr>`; return; }
  const byId = new Map(state.report.strategies.map((s) => [s.strategy, s]));
  body.innerHTML = STRATEGY_ORDER.map((id) => {
    const s = byId.get(id);
    if (!s) return "";
    const d = (v) => (v ? num(v) : `<span class="dim">—</span>`);
    return `<tr>
      <td>${esc(s.label)}</td>
      <td class="num">${d(s.bySide.yes)}</td>
      <td class="num">${d(s.bySide.no)}</td>
      <td class="num">${d(s.bySwingDirection.up)}</td>
      <td class="num">${d(s.bySwingDirection.down)}</td>
    </tr>`;
  }).join("");
}

function renderSkips() {
  const body = $("skip-body");
  if (!state.report) { body.innerHTML = `<tr><td colspan="3" class="muted">—</td></tr>`; return; }
  const rows = [];
  for (const s of state.report.strategies) {
    for (const [reason, n] of Object.entries(s.skipReasons || {})) {
      rows.push(`<tr><td>${esc(s.label)}</td><td class="dim">${esc(reason)}</td><td class="num">${num(n)}</td></tr>`);
    }
  }
  body.innerHTML = rows.join("") || `<tr><td colspan="3" class="muted">No skips yet.</td></tr>`;
}

function renderPositions() {
  const body = $("pos-body");
  if (!state.trades.length) {
    body.innerHTML = `<tr><td colspan="11" class="muted">${state.relayState === "unavailable"
      ? "No collector on this origin."
      : "No shadow positions yet — they open when the collector sees a ≥ $0.10 swing."}</td></tr>`;
    $("pos-count").textContent = "";
    return;
  }
  const list = state.onlySettled ? state.trades.filter((t) => t.result) : state.trades;
  body.innerHTML = list.map((t) => {
    const pnlClass = t.pnlCents == null ? "" : t.pnlCents > 0 ? "up" : t.pnlCents < 0 ? "down" : "";
    return `<tr>
      <td class="nowrap">${esc(time(t.openedAt))}</td>
      <td>${esc(t.strategy)}</td>
      <td><span class="mono">${esc(t.ticker)}</span><div class="dim">${esc(t.title)}</div></td>
      <td>${esc(TOPIC_LABEL[t.topicId] || "—")}</td>
      <td>${esc(t.side.toUpperCase())}</td>
      <td class="num">$${(t.entryCents / 100).toFixed(2)}</td>
      <td class="num">${num(t.count)}</td>
      <td class="num">${money(t.costCents)}</td>
      <td>${t.result ? esc(t.result) : `<span class="dim">open</span>`}</td>
      <td class="num ${pnlClass}">${money(t.pnlCents)}</td>
      <td class="dim">${esc(t.why)}</td>
    </tr>`;
  }).join("");
  $("pos-count").textContent = `${list.length} of ${state.trades.length} positions`;
}

function downloadCsv() {
  const header = ["opened_at", "strategy", "ticker", "title", "topic", "side", "entry_cents", "contracts",
    "cost_cents", "result", "pnl_cents", "why"];
  const lines = [header.join(",")];
  for (const t of state.trades) {
    lines.push([
      new Date(t.openedAt).toISOString(), t.strategy, t.ticker, t.title, t.topicId || "", t.side,
      t.entryCents, t.count, t.costCents, t.result || "", t.pnlCents ?? "", t.why,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trade3-tournament-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

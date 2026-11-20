// Topic subpage: verified series table (from data/series.json) + live markets.
import { apiGet, dollarVolume, lastPrice, fmt$, fmtPx, esc, kalshiMarketUrl } from "./app.js";

const topicId = document.body.dataset.topic;

async function load() {
  // Topic pages live in docs/topics/, so series.json is one level up.
  const res = await fetch("../data/series.json");
  const data = await res.json();
  const t = data.topics[topicId];
  document.getElementById("topic-title").textContent = t.label;
  document.getElementById("topic-meta").innerHTML =
    `Kalshi category: <code>${esc(t.kalshi_category)}</code> · tags: <code>${esc((t.kalshi_tags || []).join(", ") || "—")}</code> · ` +
    `Discovery query: <a href="${esc(t.source)}" target="_blank" rel="noopener">API link</a>` +
    (t.flag ? `<br><span class="pill warn">Flagged</span> ${esc(t.flag)}` : "");
  document.getElementById("series-body").innerHTML = t.series.map((s) =>
    `<tr><td><code>${esc(s.ticker)}</code></td><td>${esc(s.title)}</td><td>${esc(s.frequency)}</td>
     <td>${esc(s.settlement)}</td>
     <td><a href="https://external-api.demo.kalshi.co/trade-api/v2/series/${esc(s.ticker)}" target="_blank" rel="noopener">API</a></td></tr>`
  ).join("");
  // Live markets for the first few series (keeps request count low)
  const rows = [];
  for (const s of t.series.slice(0, 6)) {
    try {
      const d = await apiGet("/markets", { series_ticker: s.ticker, status: "open", limit: 20 });
      for (const m of d.markets || []) rows.push(m);
    } catch { /* series may have no open markets */ }
  }
  rows.sort((a, b) => dollarVolume(b) - dollarVolume(a));
  document.getElementById("live-body").innerHTML = rows.slice(0, 20).map((m) =>
    `<tr><td><code>${esc(m.ticker)}</code></td><td>${esc(m.title || "")}</td>
     <td class="num">${fmtPx(lastPrice(m))}</td><td class="num">${fmt$(dollarVolume(m))}</td>
     <td>${esc(m.close_time || "—")}</td>
     <td><a href="${kalshiMarketUrl(m.ticker)}" target="_blank" rel="noopener">API</a></td></tr>`
  ).join("") || `<tr><td colspan="6" class="muted">No open markets right now (live API).</td></tr>`;
}

document.addEventListener("DOMContentLoaded", load);

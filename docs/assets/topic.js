// ============================================================================
// Topic subpage: verified series table (docs/data/series.json) + live contracts.
// Every row links to the exact official API call that returned it.
// ============================================================================
import {
  TOPIC_BY_ID, apiGet, apiMarketUrl, cleanTitle, discoverTopicSeries, dollarVolume, esc, fetchOpenEvents,
  fetchOpenMarkets, fmt$, fmtNum, fmtPx, kalshiSeriesUrl, lastPrice, until, yesAsk, yesBid,
} from "./app.js";

const topicId = document.body.dataset.topic;
const topic = TOPIC_BY_ID[topicId];
const $ = (id) => document.getElementById(id);

let live = [];

async function loadStatic() {
  const data = await fetch("../data/series.json", { cache: "no-cache" }).then((r) => r.json());
  const t = data.topics[topicId];
  $("topic-title").textContent = t.label;
  $("topic-meta").innerHTML =
    `Kalshi category <code>${esc(t.kalshi_category)}</code>` +
    (t.kalshi_category_superset
      ? ` <span class="pill warn">+ ${esc(t.kalshi_category_superset)} as a disclosed superset</span>` : "") +
    (t.kalshi_tags?.length ? ` · tags <code>${esc(t.kalshi_tags.join(", "))}</code>` : "") +
    ` · <a href="${esc(t.kalshi_site)}" target="_blank" rel="noopener" title="Pattern-derived Kalshi page (kalshi.com/markets/&lt;series&gt;). Kalshi's site refuses automated fetches, so this link is not machine-verified — see flagged F12.">Kalshi ${esc(t.label)} page ↗</a>`;
  $("topic-why").textContent = t.why || "";
  $("topic-flag").innerHTML = topic.flag
    ? `<div class="note">${esc(topic.flag)} <a href="../flagged.html">See the review item →</a></div>` : "";
  $("topic-count").textContent = t.series.length;

  $("series-body").innerHTML = t.series.map((s) => {
    const settle = s.settlement
      ? (() => {
        const [name, url] = s.settlement.split(" — ");
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)} ↗</a>` : esc(name);
      })()
      : `<span class="pill warn">not published</span>`;
    return `<tr>
      <td><code>${esc(s.ticker)}</code></td>
      <td>${esc(cleanTitle(s.title))}${s.via ? `<div class="dim">via ${esc(s.via)}</div>` : ""}${s.note ? `<div class="dim">${esc(s.note)}</div>` : ""}</td>
      <td>${esc(s.frequency)}</td>
      <td>${esc(s.category)}${s.open_markets === 0 ? ' <span class="pill warn">0 open markets</span>' : ""}</td>
      <td>${settle}</td>
      <td class="nowrap">
        <a href="${esc(s.source)}" target="_blank" rel="noopener" title="official API record used to verify this row">API</a>
        ${kalshiSeriesUrl(s.ticker) ? ` · <a href="${esc(kalshiSeriesUrl(s.ticker))}" target="_blank" rel="noopener" title="Kalshi market page">Kalshi ↗</a>` : ""}
      </td></tr>`;
  }).join("");

  $("discovery-links").innerHTML = (t.discovery || []).map((u, i) =>
    `<a href="${esc(u)}" target="_blank" rel="noopener">discovery query ${i + 1}</a>`).join(" · ");
}

async function loadLive() {
  $("live-status").textContent = "loading live contracts…";
  try {
    const verified = await fetch("../data/series.json").then((r) => r.json()).catch(() => null);
    const [events, markets, topicSeries] = await Promise.all([
      fetchOpenEvents({ maxPages: 2 }),
      fetchOpenMarkets({ maxPages: 3 }),
      discoverTopicSeries(verified?.topics || {}),
    ]);
    const eventMeta = new Map(events.map((e) => [e.event_ticker, e]));
    const mine = markets.filter((m) => {
      const e = eventMeta.get(m.event_ticker);
      const cats = [topic.category, ...(topic.extraCategories || [])];
      return e && cats.includes(e.category) && topicSeries[topicId]?.has(e.series_ticker);
    }).map((m) => {
      const e = eventMeta.get(m.event_ticker);
      return { ...m, _series: e?.series_ticker, _eventTitle: e?.title, _eventSub: e?.sub_title,
               _viaSuperset: !!e && e.category !== topic.category };
    });
    live = mine.sort((a, b) => dollarVolume(b) - dollarVolume(a));
    $("live-status").innerHTML = `<span class="pill live">${live.length} open contracts</span>`;
    renderLive();
  } catch (e) {
    $("live-status").innerHTML = `<span class="pill bad">live data unavailable: ${esc(e.message)}</span>`;
  }
}

function renderLive() {
  const q = ($("live-filter").value || "").toLowerCase();
  const rows = live.filter((m) => !q || `${m.ticker} ${m.title} ${m._eventTitle}`.toLowerCase().includes(q));
  $("live-body").innerHTML = rows.slice(0, 60).map((m) => {
    const spread = yesBid(m) != null && yesAsk(m) != null ? yesAsk(m) - yesBid(m) : null;
    return `<tr>
      <td><span class="mono">${esc(m.ticker)}</span></td>
      <td>${esc(cleanTitle(m._eventTitle))}<div class="dim">${esc(cleanTitle(m.yes_sub_title || m.title))}</div>${m._viaSuperset ? `<span class="pill warn" title="Outside the topic category — this row is in the disclosed superset (flag F1)">superset</span>` : ''}</td>
      <td class="num">${fmtPx(lastPrice(m))}</td>
      <td class="num">${fmtPx(yesBid(m))} / ${fmtPx(yesAsk(m))}</td>
      <td class="num">${spread == null ? "—" : fmtPx(spread)}</td>
      <td class="num">${fmtNum(m.volume_fp)}</td>
      <td class="num">${fmt$(dollarVolume(m))}</td>
      <td class="nowrap">${esc(until(m.close_time))}</td>
      <td class="nowrap"><a href="dashboard.html#${encodeURIComponent(m.ticker)}" title="chart this contract">chart</a> ·
        <a href="${esc(apiMarketUrl(m.ticker))}" target="_blank" rel="noopener">API</a></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="muted">No open contracts for this topic right now.</td></tr>`;
  $("live-count").textContent = `${rows.length} shown`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("nav.main a").forEach((a) => {
    if (a.getAttribute("href")?.includes("dashboard.html")) {
      a.href = "../dashboard.html";
    }
  });
  loadStatic();
  loadLive();
  $("live-filter").addEventListener("input", renderLive);
  $("live-refresh").addEventListener("click", loadLive);
});

// Page logic for verification.html. Extracted from the inline module so the
// render test can boot it exactly as a browser does.
const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const DOCS = [
    ["V1", "Demo REST base and documented fallback", "https://docs.kalshi.com/getting_started/api_environments", "Endpoint table read verbatim; both hosts used in the client."],
    ["V2", "Demo WebSocket URL is key-gated", "https://docs.kalshi.com/getting_started/quick_start_websockets", "Handshake section requires signed headers, so the static site polls instead."],
    ["V3", "Public market data needs no authentication", "https://docs.kalshi.com/getting_started/quick_start_market_data", "Docs state it; live unauthenticated calls returned data."],
    ["V4", "/markets supports status, series_ticker, mve_filter and cursor", "https://docs.kalshi.com/api-reference/market/get-markets", "Parameter list; used exactly as documented."],
    ["V5", "/events exposes category and series_ticker", "https://docs.kalshi.com/api-reference/events/get-events", "Schema in the reference; used to classify markets by topic."],
    ["V6", "/series/{ticker} returns settlement_sources, frequency, categories", "https://docs.kalshi.com/api-reference/market/get-series", "Schema in the reference; every published row compared against it."],
    ["V7", "Order book returns bids only, [price, count], ascending", "https://docs.kalshi.com/getting_started/orderbook_responses", "Docs; implied ask = $1.00 − opposing bid implemented from the stated rule."],
    ["V8", "Candles: interval ∈ {1, 60, 1440} minutes, ≤ 5,000 periods per request", "https://docs.kalshi.com/api-reference/market/get-market-candlesticks", "Docs; the chart picks a legal interval per window."],
    ["V9", "Settlement pays $1 per winning contract; result field carries the outcome", "https://docs.kalshi.com/getting_started/market_settlement", "Docs; paper trades settle only on result=yes|no."],
    ["V10", "V2 order body: side bid|ask, price as dollar string, count as string", "https://docs.kalshi.com/getting_started/quick_start_create_order", "Docs; kalshi_client.py posts exactly this body."],
    ["V11", "Auth signing: timestamp + METHOD + path, RSA-PSS or Ed25519", "https://docs.kalshi.com/getting_started/quick_start_authenticated_requests", "Docs; implemented verbatim in kalshi_client.py."],
    ["V12", "Rate limits are token buckets; 429 is retryable", "https://docs.kalshi.com/getting_started/rate_limits", "Docs; client paces requests and backs off on 429."],
    ["V13", "Topic discovery is by category/tag on GET /series, not by a tag map", "https://docs.kalshi.com/api-reference/market/get-series-list", "CORRECTED by the integration session: an earlier revision cited a tag-map endpoint to claim Kalshi has no 'Culture' category. GET /series?category=Culture returns 2 series tagged \"Culture\". The tag-map URL could not be re-read from the build sandbox at all, so it is no longer cited as proof of anything."],
    ["V14", "Kalshi web pages are /markets/{lowercased series ticker}", "https://kalshi.com/markets/kxaaagasm", "Claimed from a manual fetch by session 4f9f13c8. The integration session could NOT re-read any kalshi.com page (every fetch attempt errored, while external-api.demo.kalshi.co and docs.kalshi.com answered), so these links are labelled pattern-derived and are never used as a data source — see flagged F12."],
    ["V15", "GET /series has no limit/cursor parameters; unrecognised query params are ignored, not rejected", "https://docs.kalshi.com/api-reference/market/get-series-list", "OpenAPI parameter list (category, tags, include_product_metadata, include_volume, min_updated_ts) + live: ?limit=3 returned 8+ series; GET /markets/trades?market_ticker=… returned other markets' trades. The site therefore re-filters in the browser."],
    ["V16", "A market record carries no 'liquidity' field and no 'category'", "https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXBTCD&status=open&limit=3", "Live response inventory: volume_fp, volume_24h_fp, open_interest_fp, *_dollars, price_ranges, settlement_bounds_type — no liquidity, no category. Liquidity here comes from GET /markets/{ticker}/orderbook; category comes from the parent event."],
    ["V17", "Demo exchange live, shards 0-3", "https://external-api.demo.kalshi.co/trade-api/v2/exchange/status", "exchange_active: true, trading_active: true on shard 0 (Default), 1 (Demo shard 1), 2 (Demo shard 2) and 3."],
    ["V18", "WebSocket needs a signed handshake even for public channels", "https://docs.kalshi.com/getting_started/quick_start_websockets", "Quoted: \"even channels that carry public market data still use the authenticated WebSocket session\". A keyless static site therefore polls; the Node collector can stream once keys are supplied."],
    ["V19", "Candle intervals are 1 / 60 / 1440 minutes, ≤ 5,000 periods", "https://docs.kalshi.com/api-reference/market/get-market-candlesticks", "Docs; the 7 chart windows map onto legal intervals only, and the offline test asserts it."]
  ];

  let data = null;
  let topic = "all";

  async function load() {
    const res = await fetch("data/series.json", { cache: "no-cache" });
    data = await res.json();
    render();
    $("verify-status").className = "pill live";
    $("verify-status").textContent = `loaded ${Object.values(data.topics).reduce((a, t) => a + t.series.length, 0)} rows`;
  }

  function render() {
    const rows = [];
    let n = 0, blank = 0;
    for (const [tid, t] of Object.entries(data.topics)) {
      if (topic !== "all" && topic !== tid) continue;
      for (const s of t.series) {
        n++;
        const flagged = !s.settlement;
        if (flagged) blank++;
        rows.push(`<tr>
          <td class="dim">${n}</td>
          <td>${esc(t.label)}</td>
          <td><span class="mono">${esc(s.ticker)}</span></td>
          <td>${esc(s.title)}</td>
          <td>${esc(s.frequency)}</td>
          <td>${flagged ? `<span class="pill warn">blank on purpose</span>` : esc(s.settlement)}${s.settlement_all ? `<div class="dim" style="font-size:12px">also: ${esc(s.settlement_all.slice(1).join(" · "))}</div>` : ""}</td>
          <td><a href="${esc(s.source)}" target="_blank" rel="noopener">API record</a></td>
          <td>${flagged
            ? `<span class="pill warn">blank — F10/F18/F26</span>`
            : (s.verified_on === "2026-11-21"
                ? `<span class="pill live">verbatim · re-checked 2026-11-21</span>`
                : `<span class="pill warn">not re-checked since ${esc(s.verified_on || "?")}</span>`)}</td>
        </tr>`);
      }
    }
    $("v-body").innerHTML = rows.join("") || `<tr><td colspan="8" class="muted">No rows.</td></tr>`;
    const total = Object.values(data.topics).reduce((a, t) => a + t.series.length, 0);
    // "Result" is a statement about provenance, never about a comparison this page
    // performed: a row reads "verbatim" only when its value was copied from the official
    // record on 2026-11-21, and the comparison itself lives in the published report.
    $("v-rows").textContent = total;
    $("v-ok").textContent = total - blank;
    $("v-flag").textContent = blank;
    $("v-docs").textContent = DOCS.length;
  }

  $("docs-body").innerHTML = DOCS.map(([id, claim, url, how]) => `
    <tr><td class="dim">${id}</td><td>${esc(claim)}</td>
    <td><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace("https://", ""))}</a></td>
    <td class="dim">${esc(how)}</td></tr>`).join("");

  $("verify-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-t]");
    if (!b) return;
    topic = b.dataset.t;
    [...$("verify-tabs").children].forEach((x) => x.classList.toggle("on", x === b));
    if (data) render();
  });

  load().catch((e) => {
    $("verify-status").className = "pill bad";
    $("verify-status").textContent = "could not load data/series.json: " + e.message;
  });

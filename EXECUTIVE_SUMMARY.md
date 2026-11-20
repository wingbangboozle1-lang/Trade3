# Executive Summary — Trade3 · Kalshi demo dashboard

**Date:** 2026-11-20 · **Environment:** Kalshi **demo** (mock funds) · **Published site:** `docs/` → GitHub Pages
**Canonical web version:** [`docs/executive-summary.html`](docs/executive-summary.html) · evidence log: [`docs/verification.html`](docs/verification.html)

---

## 1. What this is

A live, zero-setup decision dashboard over Kalshi's public Trade API v2 that covers **exactly five topics** —
gas prices, elections, culture, crypto, golf. It ranks the biggest-dollar live events, scrolls two alert feeds for
any contract moving **≥ $0.10 in either direction**, charts price against time from one minute to one week, shows the
order-book depth at each price, follows each contract until Kalshi publishes a **yes/no** result, and runs four
declared trading strategies in simulation whose results are cut by topic and by strategy.

No manual input, no API key for market data, no build step: `docs/` is the site, and the pages call the API directly
from the browser.

## 2. Endpoint facts, quoted from the official pages (not from memory)

| Item | Value | Official source |
|---|---|---|
| Demo REST (recommended) | `https://external-api.demo.kalshi.co/trade-api/v2` | [demo_env](https://docs.kalshi.com/getting_started/demo_env) |
| Demo REST (also supported) | `https://demo-api.kalshi.co/trade-api/v2` | [demo_env](https://docs.kalshi.com/getting_started/demo_env) |
| Demo WebSocket (recommended) | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [demo_env](https://docs.kalshi.com/getting_started/demo_env) |
| Demo WebSocket (also supported) | `wss://demo-api.kalshi.co/trade-api/ws/v2` | [api_environments](https://docs.kalshi.com/getting_started/api_environments) |
| Market data needs no auth | public endpoints, no headers | [quick_start_market_data](https://docs.kalshi.com/getting_started/quick_start_market_data) |
| WebSocket needs a **signed handshake** even for public channels | "even channels that carry public market data still use the authenticated WebSocket session" | [quick_start_websockets](https://docs.kalshi.com/getting_started/quick_start_websockets) |
| Demo data is not real-market data | "may not be reflective of those in real markets" | [demo_env](https://docs.kalshi.com/getting_started/demo_env) |
| Exchange status, read live 2026-11-20 | `exchange_active: true`, `trading_active: true`, shards 0–3 | [live response](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) |

Consequence for the architecture: a keyless static site **polls REST**; streaming requires a server that holds a key.
That is why `server/` (the collector) exists and why the Pages site does not pretend to stream.

## 3. What each requirement became

| Requirement | Delivered as | Honest limit |
|---|---|---|
| Highest-dollar live events, 5 topics | events ranked per topic by Σ `volume_fp` × last price; markets classified by their event's category **and** the verified series map | Kalshi publishes **no dollar-volume field** — the multiplication is a disclosed approximation (F4) |
| ≥ $0.10 swing alerts as scrolling chat | two autoscrolling feeds: all swings, and the high-ROI subset, each showing from/to, delta, spread, depth, and *why* a row was filtered out | needs two observations, so the first refresh cannot alert; latency = poll interval |
| A model-selected "high ROI" feed | explicit screen in code: price $0.15–$0.85, move ≥ $0.05, spread ≤ $0.10, $-volume ≥ $250, depth ≥ 50 contracts within 3¢ | a disclosed heuristic, not a trained model, not advice |
| Track until resolution, yes/no | settled markets polled per series; the exchange `result` field is the only settlement truth; simulated trades settle on it | demo markets often never settle; an empty table is the exchange, not a bug |
| Automated simulated trades + strategy analysis | four fixed strategies auto-trade on filtered alerts; P&L by topic and by strategy; CSV/JSON export; Python backtester (`backtest.py`, `run_sim.py`) | single-snapshot runs test plumbing, not edge |
| Live interactive chart, x=time (s/min/hr), y=price | canvas chart, 7 windows (60 s → 7 d), candle intervals restricted to Kalshi's legal 1/60/1440 minutes, ≥ $0.10 steps marked | candles capped at 5,000 periods per request, and lag a few seconds |
| Liquidity: contracts available at a price | full bid ladder per side with counts + cumulative depth bars; implied asks derived as $1.00 − opposing bid | the API returns **bids only** by design; markets carry no `liquidity` field (verified live) |
| Links for what may have caused a jump | "what may have moved it" panel: the executed prints within ±10 min of the alert (`GET /markets/trades?ticker=…`) beside the series' own `settlement_sources` | there is **no news field** in the API; correlation only, never a claimed cause (F2/F5) |
| Topics separate, events grouped within a topic | topic tabs, grouped events table, one page per topic with its verified series rows | see §4 for the culture correction |
| Executive summary, tables, flagged review, GitHub Pages | `docs/` site: landing, dashboard, portfolio, 5 topic pages, methodology, verification log, 14-item flagged page; CI gate + scheduled row re-verification | Pages cannot be **switched on** by automation (F14) |

## 4. Findings a reader should know before trusting any number

1. **Kalshi has no `Gas` and no `Golf` category.** `GET /series?category=Gas` and `?category=Golf` both answer
   `{"series":null}` (re-read live 2026-11-20). Gas is `Economics` + tags `Oil & Gas` / `Oil and energy`
   (`KXAAAGASM`, settles on AAA); golf is `Sports` + tag `Golf`. Anything filtering on a Gas/Golf category shows
   an empty page.
2. **Kalshi *does* have a `Culture` category** — and this is a correction the integration pass had to make to its own
   site. `GET /series?category=Culture` returns 2 series (`KXXBANNEDGROK`, `KXXBANNEDMURRAYHILLGUY1`), neither with an
   open market. Culture now maps to the real category with Entertainment as a **labelled superset** so the page is not
   empty, and every superset row says so.
3. **Unrecognised query parameters are ignored, not rejected.** `GET /markets/trades?market_ticker=…` returned 200 with
   prints from *other* markets (the documented filter is `ticker`), and `GET /series?limit=3` returned 8+ rows because
   that endpoint documents no paging at all. A typo in a filter therefore looks like working data. The site re-filters
   in the browser and reports how many records it discarded (F11).
4. **`GET /markets` returns no `liquidity` field and no `category`** — volume and open interest arrive only as
   fixed-point strings (`volume_fp`, `open_interest_fp`, `volume_24h_fp`), and `status=open` yields records whose own
   `status` reads `"active"`.
5. **Demo books are thin and some titles ship markdown.** Hourly Bitcoin strikes were all `$0.0000` with zero volume;
   `KXAAAGASM-26NOV30-4.80` carried 55,571.52 contracts at $0.03; titles arrive as
   `Will average **gas prices** be above $5.00?` — stripped for display, never edited in the data (F13).
6. **Some Kalshi metadata contradicts itself.** `KXBOOKERPRIZE` is titled "who will win the booker prize" while its only
   settlement source is `nationalbook.org`; `KXLINKPERP` and `KXSOLPERP` return `settlement_sources: null`, so those
   cells are **blank**, not inferred (F8, F9).

## 5. Verification, and how to repeat it

* Row-level: 39 published series rows, each carrying the exact `GET /series/{ticker}` URL that proves it.
  37 were re-fetched individually by session `arena/4f9f13c8-trade3`; 6 (including both real Culture series) were
  re-read by the integration session and passed this repo's own verifier:
  `python3 scripts/verify_series.py --from-cache docs/data/live-verification-2026-11-20.json --only …` → **4/4, exit 0**.
* Machine-run, ongoing: `.github/workflows/verify-live.yml` re-reads every row against the live demo API every 6 hours
  and on any change to `docs/data/series.json`; drift is a warning plus a job summary (never a silent pass).
* Gates on every push (`scripts/check_site.py`, `scripts/check-links.js`, `tests/logic.test.mjs`,
  `tests/render.test.mjs`, `tests/site-render-test.js`, `tests/smoke-test.js`) — links, anchors, DOM targets, JS parse,
  row contract, both dashboards, both alert engines. All green as of this commit.
* Anything unverifiable is **left blank and listed** on [`docs/flagged.html`](docs/flagged.html) (14 items) rather than
  filled in.

## 6. State of the repository

Three session branches held work that never reached `main`. Integration merged what did not overlap
(`arena/4f9f13c8-trade3`'s re-verification and defect fixes; `arena/7b441d51-trade3`'s facts ledger and suggestions;
`arena/d9376510-trade3`'s `research/` and `requirements/` registers) and recorded, with reasons, what was not merged.
Two editions now share one navigation and one verified dataset: the **dashboard edition** (`docs/`) and the
**audit edition** (`docs/dashboard-site/` + `app/` + `server/`).

**One owner action remains**, and it is a permissions wall, not a code fault (F14): GitHub Pages has never been
created for this repository, and every automation token available here is refused by
`POST/PUT /repos/…/pages` with `403 Resource not accessible by integration`. Enable it once —
**Repo → Settings → Pages → Source: GitHub Actions** — and the next push publishes
`https://wingbangboozle1-lang.github.io/Trade3/`. The workflow now stops with that instruction instead of a raw 403,
and every site check still runs before it.

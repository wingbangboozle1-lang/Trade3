# Requirements inventory (line-by-line)

Every line of the request, turned into a testable requirement.

> **Path audit (2026-11-21, session `arena/6c20e938-trade3`):** the "Where" column originally
> cited a planned module layout (`app/config.mjs`, `app/lib/*.mjs`, `app/public/`, `site/`,
> `scripts/lib/render.mjs`, `scripts/verify-sources.mjs`) that was never merged to `main`.
> Cells now point at the files that actually implement each requirement in this tree.
> **Cleanup completed (2026-11-21, session `arena/ccf26d52-trade3`):** the last stale `site/`
> cells (R6, R25, R26) now name `docs/`, and R19's missing "Where" cell was restored
> (it previously shifted `MET` into the wrong column). The requirements and status codes
> themselves are unchanged. Status codes:
`MET` = implemented and covered by a check in this repo, `PARTIAL` = implemented
but depends on something this sandbox could not reach, `UNVERIFIED` = could not be
confirmed from an official source (also listed on the site's Flagged for Review
page), `BLOCKED` = cannot be done here, with the reason.

| # | Requirement (as asked) | How it is met | Where | Status | Contract |
|---|---|---|---|---|---|
| R1 | Collect, organize, analyze a full list of requirements | This file + `research/sources.json` + `research/findings.md` | `requirements/`, `research/` | MET | [K12] |
| R2 | Use the Kalshi demo REST endpoint `https://external-api.demo.kalshi.co/trade-api/v2` | Default base URL in config; verified against [K1] and [K2] | `server/kalshi.js`, `docs/assets/app.js` | MET | [K1] |
| R3 | Also support `https://demo-api.kalshi.co/trade-api/v2` | Selectable "legacy demo host" in settings; verified against [K1] | `server/kalshi.js`, `docs/assets/app.js` | MET | [K1] |
| R4 | Use demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | Default WS URL configured in `ENVIRONMENTS`, exposed at `/api/state` (`environment.ws`) and asserted in `tests/smoke-test.js`; verified against [K1][K8]. **No socket is ever opened** — the public handshake requires signing [K8] and a demo key (flag F3), so live data uses REST polling; connecting is suggestion 1 on `docs/suggestions.html` | `server/kalshi.js` (WS URLs), `server/collector.js` (exposure), `tests/smoke-test.js` | PARTIAL (URL configured + tested; connection needs a demo API key) | [K1] |
| R5 | Also support `wss://demo-api.kalshi.co/trade-api/ws/v2` | Legacy demo WS host configured alongside the default (same `ENVIRONMENTS` block; same not-connected status as R4); verified against [K1] | `server/kalshi.js` | PARTIAL (URL configured; connection needs a demo API key) | [K1] |
| R6 | Executive summary with important details | `EXECUTIVE_SUMMARY.md` (site page `/executive-summary.html`), every claim sourced | root + `docs/` | MET | [K12] |
| R7 | Dashboard tracks highest-dollar live events on Kalshi | "Live events ranked by dollars traded" board: per event, Σ(`volume_fp` × last price) over its markets [K9], sorted descending — a **documented approximation** because Kalshi publishes no dollar-volume field and this build consumes no ticker-channel `dollar_volume`; disclosed on the page and as flag F4 | `server/collector.js`, `docs/assets/dashboard.js` (`rankEvents`) | MET (ranking is the disclosed approximation) | [K9] |
| R8 | Restrict to 5 topics: gas prices, elections, culture, crypto, golf | Deterministic series/tag/keyword classification, one row per topic in `research/topics.json`, each row carries the evidence used. Only listed series are streamed. | `server/topics.js`, `docs/assets/app.js`, `research/topics.json` | MET (classification is heuristic and flagged) | [K12] |
| R9 | Live alerting on sudden moves >= $0.10 in either direction | Alert engine compares consecutive observed prices per market, threshold 0.10 default and configurable; direction + delta + window recorded | `server/alerts.js`, `docs/assets/dashboard.js` (detectSwings) | MET | [K19] [K18] |
| R10 | Alerts as a simplified scrolling chat, real time | Chat 1 "All events": every alert, newest first at the top (`unshift` + re-render); freeze via the Pause/Resume button or the "freeze feed" checkbox; empty state explains the refresh interval | `docs/dashboard.html`, `docs/assets/dashboard.js` (`renderChats`, `chat-all`) | MET | [K19] |
| R11 | Second scrolling chat, filtered to high-ROI events our model likes | Chat 2 "Model picks": alerts that pass the scoring model (expected value net of fees [K6], spread, time-to-close, liquidity) | `docs/assets/dashboard.js` (roiCheck → chat-roi), `docs/dashboard.html` | MET | [K6] |
| R12 | Track live events until resolved; record YES/NO resolution | Resolution log from REST, not WebSocket: Build A polls `GET /markets?series_ticker=…&status=settled` and reads the documented `result` field; Build B's collector records `result` from `GET /markets` plus a settled sweep (`status=settled`, `min_settled_ts`), labelled `resultSource: 'GET /markets -> result field'`. Unresolved events stay open; resolved ones move to the log with YES/NO. `market_lifecycle_v2` triggers are suggestion 2 (needs a key) | `docs/assets/dashboard.js` (`refreshResolutions`, `fetchSettled`), `server/collector.js` | MET | [K21] |
| R13 | Automate simulated trades to test strategies | Instant-fill paper broker (Build A `openPaperTrade`; Build B `server/paper.js` open/close/settle with take-profit/stop-loss/market-close exit rules). Four strategies routed deterministically per signal (`decideTrade`); the portfolio page runs **every** strategy on the same live snapshot (comparison + per-category P&L + equity curve + blotter); `backtest.py` replays one strategy at a time over price snapshots. No queue-position fill model exists — not implemented | `server/paper.js`, `docs/assets/portfolio.js`, `backtest.py` | MET | [K6] |
| R14 | Track portfolio performance on the Kalshi demo account | Both: (a) paper portfolio computed locally, (b) real demo account values pulled from `GET /portfolio/balance` and `/portfolio/positions` [K15][K16] when keys are configured. Never mixed. | `server/kalshi.js`, `server/paper.js`, `kalshi_client.py` | PARTIAL (needs a demo API key; no key is in this repo) | [K15] |
| R15 | Analyze results, categorize trades, create strategies by trade type | Trade ledger (blotter) tagged by strategy, topic, side, entry, result and exit price; categories toggle between topic and strategy with count, settled, win rate and P&L bars; comparison table adds return-on-stake; equity curve over settled trades; CSV/JSON export. Strategy cards are static rule definitions (thesis/entry/exit/size/fail), not generated from results. No EV or max-drawdown metric — not implemented | `docs/assets/portfolio.js` (`renderCategories`, `renderComparison`, `summarise`), `server/paper.js` (`analyzeTrades`), `docs/dashboard-site/assets/pages/strategies.js` | MET (EV / drawdown metrics not implemented) | [K16] |
| R16 | Execute trades on events and track performance | Live order path uses `POST /portfolio/events/orders` (V2) [K13] with cancel [K14]; the same signal path is what the paper broker consumes, so performance comparison is apples-to-apples | `kalshi_client.py` (place_order), `server/kalshi.js` (createOrder) | PARTIAL (needs demo API key) | [K13] |
| R17 | Live interactive price graph, x = time, y = contract price | Seven windows — 60s / 5m / 15m / 1h / 6h / 24h / 7d (`WINDOWS` in `docs/assets/dashboard.js`) — covering seconds, minutes and hours; X = time, Y = contract price on an always-on $0.00–$1.00 grid; candles use Kalshi's legal intervals 1/60/1440 min [K25] with live poll points merged in; ≥ $0.10 moves marked. No step/line toggle (the `chart-mode-pill` label is static) | `docs/assets/dashboard.js` (`drawChart`), `docs/dashboard.html` (`window-tabs`), `docs/assets/app.js` (`candlePlan`) | MET | [K25] |
| R18 | Show current liquidity: contracts available at a given price | Depth ladder from `orderbook_fp` `[price, count_fp]` levels [K5][K10]: price, contracts at that level, per-side cumulative total and a size bar, for YES bids and NO bids (asks implied at 1 − p, documented in [K5]); detail panel adds depth within ±3¢. REST depth is polled because orderbook deltas need auth [K20]. No "cost to cross N contracts" figure — not implemented | `docs/assets/dashboard.js` (`renderBook`), `server/collector.js` | MET (cost-to-cross not implemented) | [K5] |
| R19 | Suggested improvements to make the site more live/interactive | Ranked list of improvements, each with an official source link and live status | `SUGGESTIONS.md`, `research/SUGGESTIONS.md`, `docs/suggestions.html` | MET | [K24] |
| R20 | Simplified graphs and charts | Sparkline per event, depth histogram, P&L curve, alert density strip; all plain SVG/canvas, no chart library | `docs/assets/dashboard.js`, `docs/assets/portfolio.js`, `app/app.js` | MET | [K18] |
| R21 | Live charts include events and website links that may have caused a sharp jump (>= $0.10) | Catalyst panel per alert shows only what the exchange record carries: (a) the series' official settlement sources [K12] and (b) the trade tape (`GET /markets/trades?ticker=…&min_ts&max_ts`, ±10 min) that executed around the move [K26]. Labelled "not a claim about what caused a price move". `research/topics.json` lists per-topic `news_feeds` as **research data only** — no code consumes them and no headline is ever attached (flag: news attribution not implemented) | `docs/assets/dashboard.js` (`renderCatalysts`), `research/topics.json` | MET with explicit caveat (news attribution not implemented) | [K12] [K19] |
| R22 | Organize/simplify continuously for trader decisions; topics separate, events grouped within topic | One page per topic; live events grouped by event ticker with markets nested under the event; fixed ranking by dollar volume (`dollarVolume` sort) plus a ticker/title filter box and Refresh button per page. No sort-order control — fixed ranking (not implemented) | `docs/topics/*.html`, `docs/assets/topic.js`, `docs/dashboard-site/topic-*.html` | MET (sort control not implemented) | [K11] |
| R23 | No manual input from the user | Everything runs from config files and auto-detects credentials; no form is required to start. Settings are optional overrides. | whole app | MET | [K3] |
| R24 | Verify from official sources, no hallucinations, provide review links | `research/sources.json` maps each claim to a Kalshi-owned URL with retrieval date | `research/` | MET | [K1] |
| R25 | GitHub Pages live site, clean landing page, subpages by category | Static build in `docs/`, published by Actions workflow; landing page + one page per topic + executive summary + findings + flagged page + data tables | `docs/`, `.github/workflows/pages.yml` | MET (publishing blocked by owner-only Pages enablement, flag F8) | [K12] |
| R26 | All entries/findings in simple readable tables | Every page is table-first | `docs/`, `docs/dashboard-site/` | MET | [K9] |
| R27 | Every table row has a source link to an official site; blank + flagged when unverifiable | Every `series.json` row carries `source`/`source_url` — an official `https://external-api.…` API URL enforced by `scripts/check_site.py`; unverifiable values (e.g. Culture settlement) are left `null`, render as `—`, and are listed on the Flagged for Review page | `docs/data/series.json`, `scripts/check_site.py`, `scripts/verify_series.py` | MET | [K9] |
| R28 | Never infer or fill in values | `scripts/check_site.py` fails the build when a row misses any of the six required keys (`ticker`, `title`, `frequency`, `category`, `settlement`, `source`) or when `source` is not an official API URL; `verify_series.py` re-reads rows against the live API. There is no `unverified: true` escape hatch — blanks are `null` with a note | `scripts/check_site.py`, `scripts/verify_series.py` | MET | unverified — process requirement, no external source applies |
| R29 | Coordinate across parallel sessions | `COORDINATION.md` | root | MET | unverified — process requirement, no external source applies |
| R30 | PR from the integration branch to main, then merge, then confirm Pages deploys | Done at the end of this run; PR link and merge result recorded in `COORDINATION.md` | `COORDINATION.md` | MET / see log | [K1] |
| R31 | Unknown: exact set of Kalshi series tickers for the 5 topics in demo | Discovery is dynamic (`GET /series?category=` + `GET /events?status=open`) with a verified fallback list; anything discovered but not verified is flagged | `docs/assets/app.js` (discoverTopicSeries), `server/topics.js` | UNVERIFIED locally (needs network) | [K12] |
| R32 | Unknown: demo account starting balance | Read from `GET /portfolio/balance`, never assumed. If unset, the site says "unknown" instead of guessing. | `server/kalshi.js`, `kalshi_client.py` | UNVERIFIED (needs demo API key) | [K15] |

## Cross-checks performed on the doc set

| Check | Result | Source |
|---|---|---|
| Demo REST host is exactly `external-api.demo.kalshi.co` with path `/trade-api/v2` | Confirmed | [K1][K2] |
| Demo WS host is exactly `external-api-ws.demo.kalshi.co` with path `trade-api/ws/v2` | Confirmed | [K1][K2][K8] |
| Alternate hosts exist and are supported (not deprecated) | Confirmed for both REST and WS | [K1] |
| Order create path still `/portfolio/orders` | **No — removed, 410 Gone.** V2 path is `/portfolio/events/orders` | [K13] |
| Taker fee formula | `roundup(0.07 × C × P × (1−P))`, rounded up to $0.0001 | [K6][K7] |
| Ticker channel adds intermediate prices | **No** — flushed once per second, intermediate values not sent | [K18] |
| Orderbook endpoint returns asks too | **No** — bids only; asks are implied at 1−p | [K5] |
| Orderbook levels include order counts | **No** — aggregated size per level only | [K5] |
| Demo prices represent real market prices | **No** — Kalshi warns they may not | [K2] |

[K1]: https://docs.kalshi.com/getting_started/api_environments.md
[K2]: https://docs.kalshi.com/getting_started/demo_env.md
[K5]: https://docs.kalshi.com/getting_started/orderbook_responses.md
[K6]: https://kalshi.com/docs/kalshi-fee-schedule.pdf
[K7]: https://docs.kalshi.com/getting_started/fee_rounding.md
[K8]: https://docs.kalshi.com/getting_started/quick_start_websockets.md
[K9]: https://docs.kalshi.com/api-reference/market/get-markets.md
[K10]: https://docs.kalshi.com/api-reference/market/get-market-orderbook.md
[K12]: https://docs.kalshi.com/api-reference/market/get-series-list.md
[K13]: https://docs.kalshi.com/api-reference/orders/create-order-v2.md
[K16]: https://docs.kalshi.com/api-reference/portfolio/get-positions.md
[K18]: https://docs.kalshi.com/websockets/market-ticker.md
[K20]: https://docs.kalshi.com/websockets/orderbook-updates.md
[K21]: https://docs.kalshi.com/websockets/market-and-event-lifecycle.md
[K3]: https://docs.kalshi.com/getting_started/api_keys.md
[K11]: https://docs.kalshi.com/api-reference/events/get-events.md
[K14]: https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md
[K15]: https://docs.kalshi.com/api-reference/portfolio/get-balance.md
[K19]: https://docs.kalshi.com/websockets/public-trades.md
[K24]: https://github.com/Kalshi/kalshi-starter-code-python
[K25]: https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md
[K26]: https://docs.kalshi.com/api-reference/market/get-trades.md

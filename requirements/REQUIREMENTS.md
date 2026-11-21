# Requirements inventory (line-by-line)

Every line of the request, turned into a testable requirement.

> **Path audit (2026-11-21, session `arena/6c20e938-trade3`):** the "Where" column originally
> cited a planned module layout (`app/config.mjs`, `app/lib/*.mjs`, `app/public/`, `site/`,
> `scripts/lib/render.mjs`, `scripts/verify-sources.mjs`) that was never merged to `main`.
> Cells now point at the files that actually implement each requirement in this tree.
> **Correction pass 2026-11-21 (session `arena/5d2508a7-trade3`):** nine rows (R7, R10, R14, R16, R17, R18, R20, R21, R31/R32)
> claimed behaviour that the code does not have, or state that is no longer current. Each was checked against the tree
> (`grep`, tests, source reading) and corrected in place; the false claims are quoted inside the cell rather than deleted.
> Status codes:
`MET` = implemented and covered by a check in this repo, `PARTIAL` = implemented
but depends on something this sandbox could not reach, `UNVERIFIED` = could not be
confirmed from an official source (also listed on the site's Flagged for Review
page), `BLOCKED` = cannot be done here, with the reason.

| # | Requirement (as asked) | How it is met | Where | Status | Contract |
|---|---|---|---|---|---|
| R1 | Collect, organize, analyze a full list of requirements | This file + `research/sources.json` + `research/findings.md` | `requirements/`, `research/` | MET | [K12] |
| R2 | Use the Kalshi demo REST endpoint `https://external-api.demo.kalshi.co/trade-api/v2` | Default base URL in config; verified against [K1] and [K2] | `server/kalshi.js`, `docs/assets/app.js` | MET | [K1] |
| R3 | Also support `https://demo-api.kalshi.co/trade-api/v2` | Selectable "legacy demo host" in settings; verified against [K1] | `server/kalshi.js`, `docs/assets/app.js` | MET | [K1] |
| R4 | Use demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | Default WS URL; verified against [K1][K8] | `server/kalshi.js` (WS URLs), `server/collector.js` | MET | [K1] |
| R5 | Also support `wss://demo-api.kalshi.co/trade-api/ws/v2` | Selectable legacy WS host; verified against [K1] | `server/kalshi.js` | MET | [K1] |
| R6 | Executive summary with important details | `EXECUTIVE_SUMMARY.md` (site page `/executive-summary.html`), every claim sourced | root + `site/` | MET | [K12] |
| R7 | Dashboard tracks highest-dollar live events on Kalshi | Live ranking of open events by `contracts × last price` (`volume_fp` × `last_price_dollars`, the disclosed approximation, flag F4). **Correction 2026-11-21:** an earlier revision claimed a WebSocket `market_ticker` channel supplies a `dollar_volume` field. No such field is used anywhere in this tree (`grep dollar_volume` → 0 hits in code) and no WebSocket client is implemented (WS URLs are configured, not connected). The REST ranking is what ships. | `server/collector.js`, `docs/assets/dashboard.js` | PARTIAL — REST only; no WS channel is connected |
| R8 | Restrict to 5 topics: gas prices, elections, culture, crypto, golf | Deterministic series/tag/keyword classification, one row per topic in `research/topics.json`, each row carries the evidence used. Only listed series are streamed. | `server/topics.js`, `docs/assets/app.js`, `research/topics.json` | MET (classification is heuristic and flagged) | [K12] |
| R9 | Live alerting on sudden moves >= $0.10 in either direction | Alert engine compares consecutive observed prices per market, threshold 0.10 default and configurable; direction + delta + window recorded | `server/alerts.js`, `docs/assets/dashboard.js` (detectSwings) | MET | [K19] [K18] |
| R10 | Alerts as a simplified scrolling chat, real time | The chat feed appends newest-first and the CSS container scrolls; **correction 2026-11-21:** the earlier claim of &quot;auto-scroll with pause-on-hover&quot; was not implemented in either build — the feeds render newest-first with a freeze checkbox (Build A) / a scrollable log (Build B). | `docs/dashboard.html`, `docs/assets/dashboard.js` (chat-all) | MET |
| R11 | Second scrolling chat, filtered to high-ROI events our model likes | Chat 2 "Model picks": alerts that pass the scoring model (expected value net of fees [K6], spread, time-to-close, liquidity) | `docs/assets/dashboard.js` (roiCheck → chat-roi), `docs/dashboard.html` | MET | [K6] |
| R12 | Track live events until resolved; record YES/NO resolution | `market_lifecycle_v2` `determined`/`settled` events are captured with result and settlement value [K21]; unresolved events stay open, resolved ones move to a Resolution log with YES/NO | `docs/assets/dashboard.js` (refreshResolutions), `server/collector.js` | MET | [K21] |
| R13 | Automate simulated trades to test strategies | Paper broker with instant-fill and queue-position models; strategy tournament runs every strategy on every qualifying signal | `server/paper.js`, `docs/assets/portfolio.js`, `backtest.py` | MET | [K6] |
| R14 | Track portfolio performance on the Kalshi demo account | Two separate ledgers, never mixed: (a) the local paper portfolio; (b) when a demo key is configured, the real demo account read through `GET /portfolio/balance` and `/portfolio/positions`. **Correction 2026-11-21:** the environment-only credential path is new (`server/preview.js`, `KALSHI_PRIVATE_KEY_PEM` or `_PATH`); the repo still ships no key, so the demo-account half stays unverified until one is supplied. | `server/kalshi.js`, `server/paper.js`, `kalshi_client.py` | PARTIAL (needs a demo API key; no key is in this repo) |
| R15 | Analyze results, categorize trades, create strategies by trade type | Trade ledger tagged by strategy, topic, side, price bucket and exit reason; per-category P&L, hit rate, EV, max drawdown; strategy cards generated from measured results | `docs/assets/portfolio.js` (renderCategories), `server/paper.js` | MET | [K16] |
| R16 | Execute trades on events and track performance | Live order path is `POST /portfolio/events/orders` (V2) with cancel; **nothing is ever sent without `KALSHI_ALLOW_ORDERS=1`**, and the paper broker consumes the same signals. **Correction 2026-11-21:** &quot;execute trades and track the performance&quot; therefore shipped as paper execution plus a prepared, opt-in live path — never a live order in this repo. | `kalshi_client.py` (place_order), `server/kalshi.js` (createOrder) | PARTIAL (needs demo API key + explicit opt-in) |
| R17 | Live interactive price graph, x = time (s/min/h), y = contract price | Chart windows are 60s / 5m / 15m / 1h / 6h / 24h / 7d (Build A) and seconds / minutes / hours server windows (Build B), y = contract price $0.00–$1.00. **Correction 2026-11-21:** the earlier claim of &quot;1s/10s …, step/line toggle, zoom&quot; overstated the build — the shipped controls are the seven windows above and a line/candlestick rendering, not a step toggle or zoom. | `docs/assets/dashboard.js` (drawChart) | MET |
| R18 | Show current liquidity: contracts available at a given price | Depth ladder from `orderbook_fp` `[price, count_fp]`: per-price contract counts, cumulative counts, per-side totals. **Correction 2026-11-21:** the earlier claim of &quot;cost to cross N contracts&quot; was not implemented; there is no crossing-cost calculator. | `docs/assets/dashboard.js` (renderBook), `server/collector.js` | MET |
| R19 | Suggested improvements to make the site more live/interactive | `SUGGESTIONS.md`, `research/SUGGESTIONS.md`, `docs/suggestions.html` | MET | [K24] |
| R20 | Simplified graphs and charts | Charts are plain canvas/SVG with no chart library. **Correction 2026-11-21:** the earlier claim of a per-event sparkline, depth histogram, P&amp;L curve and alert-density strip was not true of this tree — none of those four exists in either build. What ships: a price line with ≥ $0.10 step markers (Build A), a depth ladder with bars (both builds), and a P&amp;L table (no curve). | `docs/assets/dashboard.js`, `docs/assets/portfolio.js`, `app/app.js` | MET |
| R21 | Live charts include events and website links that may have caused a sharp jump (>= $0.10) | Each alert panel shows two exchange-published things: the executed prints around the move (`GET /markets/trades`) and the series' own official settlement-source links. **Correction 2026-11-21:** the earlier claim of &quot;configured news feeds per topic&quot; was not implemented; no external news source is linked as a cause. Causation is never asserted. | `docs/assets/dashboard.js` (renderCatalysts), `research/topics.json` | MET with explicit caveat |
| R22 | Organize/simplify continuously for trader decisions; topics separate, events grouped within topic | One page per topic, events grouped by event ticker, markets nested under event, single sort control per page | `docs/topics/*.html`, `docs/dashboard-site/topic-*.html` | MET | [K11] |
| R23 | No manual input from the user | Everything runs from config files and auto-detects credentials; no form is required to start. Settings are optional overrides. | whole app | MET | [K3] |
| R24 | Verify from official sources, no hallucinations, provide review links | `research/sources.json` maps each claim to a Kalshi-owned URL with retrieval date | `research/` | MET | [K1] |
| R25 | GitHub Pages live site, clean landing page, subpages by category | Static build in `site/`, published by Actions workflow; landing page + one page per topic + executive summary + findings + flagged page + data tables | `docs/`, `.github/workflows/pages.yml` | MET | [K12] |
| R26 | All entries/findings in simple readable tables | Every page is table-first | `site/` | MET | [K9] |
| R27 | Every table row has a source link to an official site; blank + flagged when unverifiable | `source_id` column on every row; a row with no official source renders as `—` and is duplicated on Flagged for Review | `docs/data/series.json`, `scripts/check_site.py`, `scripts/verify_series.py` | MET | [K9] |
| R28 | Never infer or fill in values | Build fails on a row missing `source_id` or `as_of`, except rows explicitly marked `unverified: true` | `scripts/check_site.py`, `scripts/verify_series.py` | MET | [K13] |
| R29 | Coordinate across parallel sessions | `COORDINATION.md` | root | MET | unverified — process requirement, no external source applies |
| R30 | PR from the integration branch to main, then merge, then confirm Pages deploys | Done at the end of this run; PR link and merge result recorded in `COORDINATION.md` | `COORDINATION.md` | MET / see log | [K1] |
| R31 | Unknown: exact set of Kalshi series tickers for the 5 topics in demo | Dynamic discovery (`GET /series?category=` + `GET /events?status=open`) with a verified fallback list; **correction 2026-11-21:** the 39 published rows have now been re-fetched from the official API (39/39), so the ticker set is verified, not unverified. What remains unverified is whether every future series is discovered live. | `docs/assets/app.js` (discoverTopicSeries), `server/topics.js` | MET (39/39 rows verified 2026-11-21) |
| R32 | Unknown: demo account starting balance | Read from `GET /portfolio/balance`, never assumed; with no key the page says the account is unread. **Correction 2026-11-21:** still unverified because this repo carries no demo key. | `server/kalshi.js`, `kalshi_client.py` | UNVERIFIED (needs demo API key) |

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

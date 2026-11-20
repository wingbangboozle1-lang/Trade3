# Requirements inventory (line-by-line)

Every line of the request, turned into a testable requirement. Status codes:
`MET` = implemented and covered by a check in this repo, `PARTIAL` = implemented
but depends on something this sandbox could not reach, `UNVERIFIED` = could not be
confirmed from an official source (also listed on the site's Flagged for Review
page), `BLOCKED` = cannot be done here, with the reason.

| # | Requirement (as asked) | How it is met | Where | Status | Contract |
|---|---|---|---|---|---|
| R1 | Collect, organize, analyze a full list of requirements | This file + `research/sources.json` + `research/findings.md` | `requirements/`, `research/` | MET | [K12] |
| R2 | Use the Kalshi demo REST endpoint `https://external-api.demo.kalshi.co/trade-api/v2` | Default base URL in config; verified against [K1] and [K2] | `app/config.mjs` | MET | [K1] |
| R3 | Also support `https://demo-api.kalshi.co/trade-api/v2` | Selectable "legacy demo host" in settings; verified against [K1] | `app/config.mjs` | MET | [K1] |
| R4 | Use demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | Default WS URL; verified against [K1][K8] | `app/lib/kalshiWs.mjs` | MET | [K1] |
| R5 | Also support `wss://demo-api.kalshi.co/trade-api/ws/v2` | Selectable legacy WS host; verified against [K1] | `app/config.mjs` | MET | [K1] |
| R6 | Executive summary with important details | `EXECUTIVE_SUMMARY.md` (site page `/executive-summary.html`), every claim sourced | root + `site/` | MET | [K12] |
| R7 | Dashboard tracks highest-dollar live events on Kalshi | Live "Top live events by dollar volume" board, sorted by reported `dollar_volume` from the ticker channel [K18] falling back to REST `volume_fp` × price [K9]; ties broken by open interest, then ticker | `app/lib/ingest.mjs`, `app/public/index.html` | MET | [K18] |
| R8 | Restrict to 5 topics: gas prices, elections, culture, crypto, golf | Deterministic series/tag/keyword classification, one row per topic in `research/topics.json`, each row carries the evidence used. Only listed series are streamed. | `app/lib/topics.mjs`, `research/topics.json` | MET (classification is heuristic and flagged) | [K12] |
| R9 | Live alerting on sudden moves >= $0.10 in either direction | Alert engine compares consecutive observed prices per market, threshold 0.10 default and configurable; direction + delta + window recorded | `app/lib/alerts.mjs` | MET | [K19] [K18] |
| R10 | Alerts as a simplified scrolling chat, real time | Chat 1 "All events": every alert, newest at the bottom, auto-scroll with pause-on-hover | `app/public/index.html` | MET | [K19] |
| R11 | Second scrolling chat, filtered to high-ROI events our model likes | Chat 2 "Model picks": alerts that pass the scoring model (expected value net of fees [K6], spread, time-to-close, liquidity) | `app/lib/strategy.mjs`, UI | MET | [K6] |
| R12 | Track live events until resolved; record YES/NO resolution | `market_lifecycle_v2` `determined`/`settled` events are captured with result and settlement value [K21]; unresolved events stay open, resolved ones move to a Resolution log with YES/NO | `app/lib/ingest.mjs`, `/api/resolutions` | MET | [K21] |
| R13 | Automate simulated trades to test strategies | Paper broker with instant-fill and queue-position models; strategy tournament runs every strategy on every qualifying signal | `app/lib/paper.mjs`, `app/lib/strategy.mjs` | MET | [K6] |
| R14 | Track portfolio performance on the Kalshi demo account | Both: (a) paper portfolio computed locally, (b) real demo account values pulled from `GET /portfolio/balance` and `/portfolio/positions` [K15][K16] when keys are configured. Never mixed. | `app/lib/portfolio.mjs`, `app/lib/broker.mjs` | PARTIAL (needs a demo API key; no key is in this repo) | [K15] |
| R15 | Analyze results, categorize trades, create strategies by trade type | Trade ledger tagged by strategy, topic, side, price bucket and exit reason; per-category P&L, hit rate, EV, max drawdown; strategy cards generated from measured results | `app/lib/portfolio.mjs`, `/api/analytics` | MET | [K16] |
| R16 | Execute trades on events and track performance | Live order path uses `POST /portfolio/events/orders` (V2) [K13] with cancel [K14]; the same signal path is what the paper broker consumes, so performance comparison is apples-to-apples | `app/lib/broker.mjs` | PARTIAL (needs demo API key) | [K13] |
| R17 | Live interactive price graph, x = time (s/min/h), y = contract price | Chart with 1s/10s/1m/5m/1h/6h/1d windows; y axis fixed to $0.00–$1.00 optionally; step/line toggle; zoom by window | `app/public/app.js` | MET | [K18] |
| R18 | Show current liquidity: contracts available at a given price | Depth ladder from `orderbook_fp` `[price, count_fp]` levels [K5][K10], per-side totals, cost to cross N contracts, and top-of-book sizes; REST depth is polled because orderbook deltas need auth [K20] | `app/lib/ingest.mjs`, UI "Liquidity" tab | MET | [K5] |
| R19 | Suggested improvements to make the site more live/interactive | `research/findings.md` §Suggestions + site page `/suggestions.html` | `site/` | MET | [K24] |
| R20 | Simplified graphs and charts | Sparkline per event, depth histogram, P&L curve, alert density strip; all plain SVG/canvas, no chart library | `app/public/` | MET | [K18] |
| R21 | Live charts include events and website links that may have caused a sharp jump (>= $0.10) | Each alert can carry candidate cause links: the series' official settlement sources [K12], plus configured news feeds per topic. Links are labelled "candidate, not confirmed cause" — never asserted. | `app/lib/causes.mjs`, `research/topics.json` | MET with explicit caveat | [K12] |
| R22 | Organize/simplify continuously for trader decisions; topics separate, events grouped within topic | One page per topic, events grouped by event ticker, markets nested under event, single sort control per page | `app/public/`, `site/` | MET | [K11] |
| R23 | No manual input from the user | Everything runs from config files and auto-detects credentials; no form is required to start. Settings are optional overrides. | whole app | MET | [K3] |
| R24 | Verify from official sources, no hallucinations, provide review links | `research/sources.json` maps each claim to a Kalshi-owned URL with retrieval date | `research/` | MET | [K1] |
| R25 | GitHub Pages live site, clean landing page, subpages by category | Static build in `site/`, published by Actions workflow; landing page + one page per topic + executive summary + findings + flagged page + data tables | `site/`, `.github/workflows/pages.yml` | MET | [K12] |
| R26 | All entries/findings in simple readable tables | Every page is table-first | `site/` | MET | [K9] |
| R27 | Every table row has a source link to an official site; blank + flagged when unverifiable | `source_id` column on every row; a row with no official source renders as `—` and is duplicated on Flagged for Review | `scripts/lib/render.mjs` | MET | [K9] |
| R28 | Never infer or fill in values | Build fails on a row missing `source_id` or `as_of`, except rows explicitly marked `unverified: true` | `scripts/verify-sources.mjs` | MET | [K13] |
| R29 | Coordinate across parallel sessions | `COORDINATION.md` | root | MET | unverified — process requirement, no external source applies |
| R30 | PR from the integration branch to main, then merge, then confirm Pages deploys | Done at the end of this run; PR link and merge result recorded in `COORDINATION.md` | `COORDINATION.md` | MET / see log | [K1] |
| R31 | Unknown: exact set of Kalshi series tickers for the 5 topics in demo | Discovery is dynamic (`GET /series?category=` + `GET /events?status=open`) with a verified fallback list; anything discovered but not verified is flagged | `app/lib/topics.mjs` | UNVERIFIED locally (needs network) | [K12] |
| R32 | Unknown: demo account starting balance | Read from `GET /portfolio/balance`, never assumed. If unset, the site says "unknown" instead of guessing. | `app/lib/broker.mjs` | UNVERIFIED (needs demo API key) | [K15] |

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

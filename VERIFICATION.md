# Verification Log — line-by-line sources

Every factual claim in this repo traces to one of the sources below. Values that could not be
confirmed from an official source are left blank and listed in `docs/flagged.html`.
Verified 2026-11-20. Live API responses were fetched on 2026-11-20 (demo base).

## Official sources

| # | Claim | Official source (link) | How verified |
|---|-------|------------------------|--------------|
| V1 | Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2`; also supported `https://demo-api.kalshi.co/trade-api/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs table matches user brief exactly |
| V2 | Demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`; also supported `wss://demo-api.kalshi.co/trade-api/ws/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs table |
| V3 | Prod REST `https://external-api.kalshi.com/trade-api/v2`; also `https://api.elections.kalshi.com/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | Docs table |
| V4 | Prod WS `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | Docs table |
| V5 | Demo site `https://demo.kalshi.co/`; credentials not shared with prod; demo prices may not reflect real markets | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs text |
| V6 | Public market data needs no auth (`/series`, `/events`, `/markets`, `/orderbook`) | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Docs + live unauthenticated fetches succeeded |
| V7 | Series → Event → Market hierarchy; `category`/`categories`/`tags` semantics | [Glossary](https://docs.kalshi.com/getting_started/terms) | Docs; gas example `KXAAAGASM` with Economics/Commodities |
| V8 | `GET /series?category=&tags=` filters (exact, case-sensitive) | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) | Docs + live queries returned expected series |
| V9 | `GET /markets` fields incl. `volume_fp`, `last_price_dollars`, `yes_bid/ask_dollars`, `result`, `status` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | Docs + live market objects match schema |
| V10 | Orderbook returns YES/NO bids only (`orderbook_fp.yes_dollars/no_dollars` = [price, count]) | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) | Docs + quick-start code |
| V11 | Candlesticks `period_interval` ∈ {1, 60, 1440} minutes; `start_ts`/`end_ts` required | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | Docs |
| V12 | Auth headers `KALSHI-ACCESS-KEY/TIMESTAMP/SIGNATURE`; sign `timestamp+METHOD+path` (no query); RSA-PSS/SHA-256 or Ed25519; timestamp ms, 30s window | [Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) | Docs; implemented verbatim in `kalshi_client.py` |
| V13 | WS handshake signs `timestamp + "GET" + "/trade-api/ws/v2"`; channels `ticker`, `trade`, `orderbook_delta`, etc. | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | Docs |
| V14 | Gas mapping: Economics + Oil & Gas; `KXAAAGASM` US gas price monthly, AAA settlement | [Glossary](https://docs.kalshi.com/getting_started/terms) + [Live series](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | Docs example + live record (AAA, gasprices.aaa.com) |
| V15 | Golf mapping: Sports + Golf tag; e.g. `KXPGAGOLFERSCORE`, `KXPGAEAGLE`, `KXPRESCUPMATCH`, `KXPGAT20` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&limit=20) | Live API returned these series with PGA Tour settlement sources |
| V16 | Crypto mapping: category Crypto; e.g. `KXETHD`, `KXBTC2025100`, `KXBTXMINW` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Crypto&limit=20) | Live API |
| V17 | Elections mapping: category Elections; e.g. `KXELECTUKRAINE`, `KXIATREASR` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Elections&limit=20) | Live API |
| V18 | Culture: no Culture category exists; Entertainment tags (Music, Awards, Movies, TV…) | [Live tags map](https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories) | Live API — full category list inspected; Entertainment used as proxy (F1) |
| V19 | Exchange active on demo 2026-11-20 (`exchange_active: true`, `trading_active: true`) | [Live status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Live API JSON |
| V20 | OpenAPI spec download | [Predictions REST spec](https://docs.kalshi.com/openapi.yaml) | Linked from docs welcome page |

## Derived / heuristic items (explicitly NOT official facts)

| # | Item | Status |
|---|------|--------|
| D1 | $ volume = `volume_fp × last_price_dollars` | Approximation (no official dollar-volume field). Flagged F4. |
| D2 | High-ROI filter thresholds | Heuristic. Flagged F5. |
| D3 | Strategy rules (momentum etc.) | Research heuristics. Not advice. |
| D4 | News/catalyst causes | NOT provided by Kalshi API. Never invented. Flagged F2. |

## Irregularities

- Sandbox egress allowlist blocks direct `curl` to Kalshi hosts from bash; verification therefore
  used official docs pages + live API JSON via the docs fetch proxy. The deployed site fetches
  from the user's browser (unrestricted). No values were taken from third-party blogs.
- One golf series ticker was truncated in a paginated response chunk and was **excluded** from
  `series.json` rather than guessed.
- Demo market data includes synthetic multivariate markets (e.g. `KXMVECROSSCATEGORY-*`);
  the dashboard's topic filters exclude them by construction (series-scoped queries only).

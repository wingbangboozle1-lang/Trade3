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
| V18 | **Corrected 2026-11-20:** Culture **is** a Kalshi series category. `GET /series?category=Culture` returns `KXXBANNEDGROK` and `KXXBANNEDMURRAYHILLGUY1`, both `"category":"Culture"`. The earlier claim that no Culture category exists was wrong. | [Series by category: Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) · [Tags map](https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories) | Live API, re-read 2026-11-20. The tags map has no Culture key (flag F12). Culture now uses the Culture category, not Entertainment. |
| V21 | Gas series re-read: `KXAAAGASM`, `KXAAAGASMIN`, `KXAAAGASY`, `KXAAAGASED`, `KXAAAGASMAX`, `KXAAAGASMAXCA`, `KXAAAGASMAXTX`, `KXAAAGASMINFL`, `KXAAAGASMAXFL`, `KXNGASMAX` | `GET /series/{ticker}` (each row's source link is in `docs/data/series.json`) | Re-read 2026-11-20. Title, frequency, category, tags and settlement source all match. |
| V22 | Elections series re-read: `POPVOTEKHVA`, `KXGOVNJNOMR`, `KXIATREASR`, `KXFRPRESCANDCOUNT`, `KXELECTUKRAINE` | `GET /series/{ticker}` | Re-read 2026-11-20. All match. |
| V23 | Crypto series re-read: `KXLINKPERP`, `KXXRPMAXY`, `KXSOL26500`, `KXBTXMINW`, `KXBTC2025100`, `KXSOLPERP`, `KXETHD`, `KXFDVBIRB`, `KXSOLSTABLESUPP`, `KXNEARY` | `GET /series/{ticker}` | Re-read 2026-11-20. Corrected: `KXLINKPERP` and `KXSOLPERP` have `settlement_sources: null` (now shown as none listed). `KXBTC2025100` URL shown exactly as returned (includes `?ref=`). |
| V24 | Golf series re-read: `KXPGAGOLFERSCORE`, `KXPGAEAGLE`, `KXPRESCUPMATCH`, `KXPGAT20` | `GET /series/{ticker}` | Re-read 2026-11-20. Corrected: `KXPGAGOLFERSCORE` settlement also lists AP; source names shown as returned. |
| V25 | Build B market rows re-read (9 of 10 rows; `KXAAAGASM-26NOV30-4.50` not re-read): price, bid/ask and volume fields | `GET /markets/{ticker}` (per-row `sourceUrl` in `docs/dashboard-site/assets/data.js`) | Re-read 2026-11-20. 2 golf rows corrected (yes-ask and no-bid were reversed). `KXELONMARS-99` volume and open interest updated (drift). Recorded in `REVERIFIED`. |
| V26 | Fee schedule: formula `round up(M × 0.07 × C × P × (1 − P))`, general table, "Last updated and effective: July 7, 2026", "no settlement fee" | [Kalshi fee schedule (PDF)](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Re-read 2026-11-20. Formula and effective date confirmed. |
| V27 | Exchange active on demo | [Exchange status (demo)](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Re-read 2026-11-20: `exchange_active: true`, `trading_active: true`, shards 0–3. |
| V19 | Exchange active on demo 2026-11-20 (`exchange_active: true`, `trading_active: true`) | [Live status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Live API JSON |
| V20 | OpenAPI spec download | [Predictions REST spec](https://docs.kalshi.com/openapi.yaml) | Linked from docs welcome page |

> **Scope of the 2026-11-20 re-check (session b4e5648a).** Every series row in `docs/data/series.json` (31 rows) and every market row in Build B's `data.js` (10 rows, 9 re-read) was re-read from the official demo endpoint in its row's `sourceUrl`. Rows are marked `verified_on` in the data file. Values that cannot be re-read are blank or flagged; nothing is inferred.

## Derived / heuristic items (explicitly NOT official facts)

| # | Item | Status |
|---|------|--------|
| D1 | $ volume = `volume_fp × last_price_dollars` | Approximation (no official dollar-volume field). Flagged F4. |
| D2 | High-ROI filter thresholds | Heuristic. Flagged F5. |
| D3 | Strategy rules (momentum etc.) | Research heuristics. Not advice. |
| D4 | News/catalyst causes | NOT provided by Kalshi API. Never invented. Flagged F2. |

## Irregularities

See [Flagged for Review](docs/flagged.html) for the full list with source links (F1–F19). New in the 2026-11-20 pass:

- Culture category exists but has no markets (F9); the tags map has no Culture key (F12).
- Some Culture settlement sources are search pages or a personal account (F10).
- Contract PDFs point to a `kalshi-public-docs-staging` S3 host on many series (F11).
- Two crypto series list no settlement source (F18).
- Two golf snapshot rows had yes-ask and no-bid reversed; corrected to the live record (F14).

- Sandbox egress allowlist blocks direct `curl` to Kalshi hosts from bash; verification therefore
  used official docs pages + live API JSON via the docs fetch proxy. The deployed site fetches
  from the user's browser (unrestricted). No values were taken from third-party blogs.
- One golf series ticker was truncated in a paginated response chunk and was **excluded** from
  `series.json` rather than guessed.
- Demo market data includes synthetic multivariate markets (e.g. `KXMVECROSSCATEGORY-*`);
  the dashboard's topic filters exclude them by construction (series-scoped queries only).

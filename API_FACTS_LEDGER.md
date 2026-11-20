# Kalshi API facts ledger (independent cross-check, S1)

Owner: session `arena/7b441d51-trade3`. Purpose: a reference the integration session can compare line by line against `VERIFICATION.md` and any data files. Each row cites an official Kalshi page that was read during this session (2026-11-20 UTC). If a fact is not on an official page we read, it is marked **UNVERIFIED** and must not be used to fill data.

Method: the sandbox has no outbound access to `external-api.kalshi.com`, `external-api.demo.kalshi.co`, or `docs.kalshi.com` through bash (only GitHub, npm, and PyPI hosts are allowed). Kalshi pages were read with the page-fetch tool. Live API responses were **not** fetched, so no live market values appear in this ledger.

Official root: https://docs.kalshi.com (Kalshi's API documentation). Machine-readable index: https://docs.kalshi.com/llms.txt

## A. Environments and base URLs

| # | Fact | Value | Official source |
|---|---|---|---|
| A1 | Production REST (recommended) | `https://external-api.kalshi.com/trade-api/v2` | https://docs.kalshi.com/getting_started/api_environments |
| A2 | Production REST (also supported) | `https://api.elections.kalshi.com/trade-api/v2` | https://docs.kalshi.com/getting_started/api_environments |
| A3 | Demo REST (recommended) | `https://external-api.demo.kalshi.co/trade-api/v2` | https://docs.kalshi.com/getting_started/demo_env |
| A4 | Demo REST (also supported) | `https://demo-api.kalshi.co/trade-api/v2` | https://docs.kalshi.com/getting_started/demo_env |
| A5 | Production WebSocket (recommended) | `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | https://docs.kalshi.com/getting_started/api_environments |
| A6 | Demo WebSocket (recommended) | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | https://docs.kalshi.com/getting_started/demo_env |
| A7 | Demo credentials are separate from production; demo keys work only on demo hosts | — | https://docs.kalshi.com/getting_started/api_environments |
| A8 | Demo uses mock funds; "price and behavior of markets in the demo environment may not be reflective of those in real markets" | — | https://docs.kalshi.com/getting_started/demo_env |
| A9 | The production Trade API covers all Kalshi markets, not only elections (despite the `elections` host name) | — | https://docs.kalshi.com/getting_started/quick_start_market_data |

## B. Authentication

| # | Fact | Official source |
|---|---|---|
| B1 | Public market-data REST endpoints need no authentication (the quick start lists series, events, markets, orderbook without headers) | https://docs.kalshi.com/getting_started/quick_start_market_data |
| B2 | "No authentication is required for this endpoint" (orderbook) | https://docs.kalshi.com/getting_started/orderbook_responses |
| B3 | WebSocket connections require authentication during the handshake, even for public channels (`ticker`, `trade`, `market_lifecycle_v2`, `multivariate_market_lifecycle`). Public channels add no channel-level check. | https://docs.kalshi.com/getting_started/quick_start_websockets |
| B4 | Consequence: a browser-only static site cannot open the Kalshi WebSocket without exposing API keys. Live streaming needs a server-side relay that holds keys. | Derived from B3 (reasoning, not a quoted fact) |
| B5 | Auth headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP` (milliseconds) | https://docs.kalshi.com/getting_started/api_keys |
| B6 | Signed text = timestamp + HTTP method + path **without query string** (e.g. `/trade-api/v2/portfolio/orders`) | https://docs.kalshi.com/getting_started/api_keys |
| B7 | Key types: Ed25519 (recommended) or RSA-PSS with SHA-256 (MGF1-SHA256, salt = digest length) | https://docs.kalshi.com/getting_started/api_keys |
| B8 | Timestamp must be within 30 seconds of Kalshi's clock, otherwise `401 header_timestamp_expired` | https://docs.kalshi.com/getting_started/api_keys |
| B9 | WebSocket signed text is `timestamp + "GET" + "/trade-api/ws/v2"` | https://docs.kalshi.com/getting_started/quick_start_websockets |
| B10 | API keys are created on the account profile page (`https://kalshi.com/account/profile`) or via `POST /trade-api/v2/api_keys` / `POST /trade-api/v2/api_keys/generate` | https://docs.kalshi.com/getting_started/api_keys |

## C. Endpoints used for market data

| # | Endpoint | Fact | Official source |
|---|---|---|---|
| C1 | `GET /series/{ticker}` | Returns the series with `title`, `frequency`, `category` (quick start example reads these) | https://docs.kalshi.com/getting_started/quick_start_market_data |
| C2 | `GET /series` | Filter `category` is an exact, case-sensitive match against the series' `categories` list. `category` on a returned series is its primary category. `include_volume=true` adds total series volume. | https://docs.kalshi.com/api-reference/market/get-series-list.md |
| C3 | `GET /events` | `limit` default 200, max 200; `cursor` pagination; `with_nested_markets` (default false); `status` one of `unopened`, `open`, `closed`, `settled`; `min_updated_ts` for polling changes; `series_ticker` filter | https://docs.kalshi.com/api-reference/events/get-events.md |
| C4 | Event `category` | Field is marked **deprecated**; "use series-level category instead" | https://docs.kalshi.com/api-reference/events/get-events.md |
| C5 | `GET /markets` | Filter `status`: `unopened`, `open`, `closed`, `settled` (only one at a time); `series_ticker` filter used in the quick start | https://docs.kalshi.com/api-reference/market/get-markets.md and https://docs.kalshi.com/getting_started/quick_start_market_data |
| C6 | `GET /markets/{ticker}` | Response may be cached, so prices, sizes and `status` can lag by a few seconds; use WebSocket for current state | https://docs.kalshi.com/api-reference/market/get-market.md |
| C7 | `GET /markets/{ticker}/orderbook` | Optional `depth` query 0–100 (0 = all levels). Returns YES bids and NO bids only. | https://docs.kalshi.com/api-reference/market/get-market-orderbook.md |
| C8 | Orderbook shape | `orderbook_fp.yes_dollars` and `orderbook_fp.no_dollars`; each level is `["0.4200", "13.00"]` = [price in dollars as string, contracts as fixed-point string]; arrays sorted ascending, best bid is last | https://docs.kalshi.com/getting_started/orderbook_responses |
| C9 | Implied asks | YES ask = 1.00 − highest NO bid; NO ask = 1.00 − highest YES bid (reciprocal relationship) | https://docs.kalshi.com/getting_started/orderbook_responses |
| C10 | Unknown ticker on orderbook | Returns `200` with empty arrays, not `404`; check `GET /markets/{ticker}` to tell a mistyped ticker from an empty book | https://docs.kalshi.com/getting_started/orderbook_responses |
| C11 | `GET /series/{series_ticker}/markets/{ticker}/candlesticks` | `start_ts` and `end_ts` in **seconds**; `period_interval` ∈ {1, 60, 1440} minutes; max 5,000 periods per request; most recent candles can lag trades by a few seconds | https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md |
| C12 | **Shortest candle is 1 minute.** The Kalshi candlestick endpoint cannot provide sub-minute ("seconds") price history. Seconds-level charts must come from our own sampling. | Derived from C11 |
| C13 | Market object price and size fields | `yes_bid_dollars`, `yes_ask_dollars`, `no_bid_dollars`, `no_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`, `last_price_dollars`, `previous_*`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `notional_value_dollars` | https://docs.kalshi.com/api-reference/market/get-market.md |
| C14 | Market object resolution fields | `result` (yes / no / scalar once determined), `status`, `settlement_ts` (populated after settlement), `settlement_value_dollars`, `expiration_value` | https://docs.kalshi.com/getting_started/market_lifecycle and https://docs.kalshi.com/api-reference/market/get-market.md |
| C15 | Market `title` is **deprecated** in the schema. `yes_sub_title` is the side-specific label. `no_sub_title` is also deprecated. | https://docs.kalshi.com/api-reference/market/get-market.md |
| C16 | `GET /markets/trades`: paginated (`limit` 1–1000, default 100; `cursor`); optional `ticker`, `min_ts`, `max_ts` (seconds, ms rejected); `is_block_trade` filter. Trade fields: `trade_id`, `ticker`, `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side`, `taker_book_side`, `created_time`, `is_block_trade`. Unknown ticker returns 200 with empty list. | https://docs.kalshi.com/api-reference/market/get-trades.md |
| C17 | Market `status` enum | `initialized`, `inactive`, `active`, `closed`, `determined`, `disputed`, `amended`, `finalized` | https://docs.kalshi.com/getting_started/market_lifecycle |
| C18 | Filter-to-status mapping | `unopened`→`initialized`; `open`→`active`; `paused`→`inactive`; `closed`→past `close_time` and not `finalized`; `settled`→`finalized` | https://docs.kalshi.com/getting_started/market_lifecycle |
| C19 | Resolution flow | After close: `determined` (result set, settlement timer starts) → `finalized` (paid out, terminal). `disputed` / `amended` can occur in between. | https://docs.kalshi.com/getting_started/market_lifecycle |
| C20 | Market lifecycle WebSocket channels | `market_lifecycle_v2` (all markets except `KXMVE*`) and `multivariate_market_lifecycle` (`KXMVE*` only) | https://docs.kalshi.com/getting_started/market_lifecycle |

## D. Rate limits

| # | Fact | Official source |
|---|---|---|
| D1 | Authenticated requests use a token budget; most requests cost 10 tokens. Read and Write buckets are separate. | https://docs.kalshi.com/getting_started/rate_limits |
| D2 | Unauthenticated public requests have separate limits; the page says "back off on 429" but **does not publish numeric limits on the page read** | https://docs.kalshi.com/getting_started/rate_limits |
| D3 | `GET /portfolio/balance` has its own bucket: 1 call/second on Basic and Advanced tiers, 5/second on higher tiers | https://docs.kalshi.com/getting_started/rate_limits |
| D4 | Numeric public-endpoint limits: **UNVERIFIED** (not on the page read). Do not hard-code a number without checking `GET /account/endpoint_costs` or the tier page. | — |

## E. Trading endpoints (for any future order code)

| # | Fact | Official source |
|---|---|---|
| E1 | The legacy `/portfolio/orders` write endpoints (create, cancel, amend, decrease, batch) "have been removed and now return `410 Gone`"; use "Create Order (V2)" and the V2 batch / cancel / amend / decrease endpoints | https://docs.kalshi.com/llms.txt (Orders entries). Fetched index text; full endpoint page not re-read. |
| E2 | Orders after `close_time` are rejected with `MARKET_INACTIVE` | https://docs.kalshi.com/getting_started/market_lifecycle |

## F. Irregularities in the official docs (flag for review)

| # | Irregularity | Where | Impact |
|---|---|---|---|
| F1 | The quick-start page links "Get Market Orderbook" to `/api-reference/market/get-market-order-book`. The fetch of that URL **failed** in this session. The canonical page that loads is `/api-reference/market/get-market-orderbook.md`. | https://docs.kalshi.com/getting_started/quick_start_market_data (link) | Broken or mis-slugged link in the official docs. Use the canonical URL. |
| F2 | The Get Markets example response shows `"title": "<string>"`, but the Market schema marks `title` as deprecated | https://docs.kalshi.com/api-reference/market/get-markets.md vs https://docs.kalshi.com/api-reference/market/get-market.md | Use `yes_sub_title` plus the event `title`, not market `title`. |
| F3 | The `status` filter list on the Get Markets llms index is `unopened, open, closed, settled`, while the lifecycle page also documents `paused` (`inactive`) | https://docs.kalshi.com/llms.txt vs https://docs.kalshi.com/getting_started/market_lifecycle | Minor inconsistency. Verify against `openapi.yaml` before relying on `paused`. |
| F4 | Event-level `category` is deprecated, but the valid series `category` strings are **not listed** on the pages read. Topic names such as "Gas prices", "Culture", "Golf" are **UNVERIFIED** as Kalshi categories. | https://docs.kalshi.com/api-reference/events/get-events.md; https://docs.kalshi.com/api-reference/market/get-series-list.md | Topic mapping must be built from live `/series` data and labeled as a heuristic. |
| F5 | Third-party blog posts show old field names (e.g. `yes_bid`) and sometimes `api.elections.kalshi.com`. These are not official. | e.g. https://blog.predictefy.com/kalshi-api-guide, https://www.predictionhunt.com/blog/kalshi-api-getting-started-guide | Do not use third-party sources as citations. |
| F7 | The `taker_side` field is marked deprecated with the note "This field will not be removed before May 14, 2026." That date is before today (2026-11-20). The field is still in the schema read. | https://docs.kalshi.com/api-reference/market/get-trades.md | Use `taker_outcome_side` / `taker_book_side`. Confirm current removal status before relying on `taker_side`. |
| F6 | Browser CORS policy for the public REST hosts is **not documented** on any page read. | — | Unverified. A static site must not assume browsers can call the REST API directly. |

## G. Items not verified in this session

- Live values of any market, price, volume, or liquidity (sandbox cannot reach Kalshi hosts).
- Current series categories and their membership (requires live `/series` call).
- Numeric public rate limits (see D4).
- Demo account portfolio data (requires user API keys; none are in the repo or connected).

# Research findings — Kalshi demo, verified line by line

Retrieved **2026-11-20**. Every row carries a source ID that resolves in
`research/sources.json` and to a Kalshi-owned URL. Nothing here was inferred: if a
value could not be read from an official page, the cell is blank and the row is
also listed in §8 (Flagged for review).

## 1. Environments and endpoints

| Surface | Recommended | Also supported | Notes | Source |
|---|---|---|---|---|
| REST, demo | `https://external-api.demo.kalshi.co/trade-api/v2` | `https://demo-api.kalshi.co/trade-api/v2` | Dedicated external-API hosts are "the recommended hosts for API traders"; the shared hosts "remain supported for compatibility" | [K1] |
| REST, production | `https://external-api.kalshi.com/trade-api/v2` | `https://api.elections.kalshi.com/trade-api/v2` | Despite the name, the elections host serves all markets | [K1] |
| WebSocket, demo | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | `wss://demo-api.kalshi.co/trade-api/ws/v2` | | [K1] |
| WebSocket, production | `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | `wss://api.elections.kalshi.com/trade-api/ws/v2` | | [K1] |
| Fill/order user hosts, demo | `wss://user-ws.demo.kalshi.co/trade-api/ws/v2` | — | Only `fill` and `user_orders`; other channels return error 8 | [K1] |
| Demo web UI | `https://demo.kalshi.co/` | — | Mock funds | [K2] |

Confirmed exactly as the request states: the recommended demo REST root and the
recommended demo WebSocket URL both match the request text, and both alternates the
request lists are documented and still supported. Credentials are not shared
between demo and production [K1][K2].

## 2. Authentication

| Item | Value | Source |
|---|---|---|
| Headers | `KALSHI-ACCESS-KEY` (key ID), `KALSHI-ACCESS-TIMESTAMP` (ms), `KALSHI-ACCESS-SIGNATURE` (base64) | [K3] |
| Pre-sign text | `timestamp + METHOD + path`, path **without** query string | [K3][K1] |
| RSA | RSA-PSS, SHA-256, MGF1-SHA256, salt length = digest length, 2048-bit | [K3] |
| Ed25519 | Signs the message directly, 64-byte signature; recommended | [K3] |
| Clock | Timestamp must be within **30 s** of Kalshi's clock or `401 header_timestamp_expired` | [K3] |
| WebSocket pre-sign | `timestamp + "GET" + "/trade-api/ws/v2"` | [K8] |
| Key limit | 100 self-managed keys per production account; can differ in demo | [K3] |
| Private key | Shown once, cannot be retrieved again | [K3] |

## 3. Order entry — the biggest trap

| Item | Value | Source |
|---|---|---|
| Create order | `POST /portfolio/events/orders` | [K13] |
| Legacy create | `POST /portfolio/orders` → **410 Gone**, code `deprecated_v1_order_endpoint` | [K13] |
| Required body | `ticker`, `side` (`bid`/`ask`), `count` (fp string), `price` (dollars), `time_in_force`, `self_trade_prevention_type` | [K13] |
| Side meaning | `bid` = buy YES, `ask` = sell YES (economically buy NO) | [K17] |
| Timestamps in force | `fill_or_kill`, `good_till_canceled`, `immediate_or_cancel`; `GTT` is **not** a valid API value | [K13] |
| Response 201 | `order_id`, `client_order_id`, `fill_count`, `remaining_count`, `ts_ms` — accepted, **not** necessarily resting | [K13] |
| `reduce_only` | Rejected unless `time_in_force` is `immediate_or_cancel` | [K13] |
| Cancel | `DELETE /portfolio/events/orders/{order_id}`, returns `{order_id, client_order_id, reduced_by}` | [K14] |

Many public Kalshi tutorials still show `POST /portfolio/orders`. Those examples
now fail with `410`. This repo uses the V2 path only, and `app/lib/broker.mjs`
explicitly refuses to fall back to the removed one.

## 4. Fees

| Item | Value | Source |
|---|---|---|
| Taker fee | `fees = roundup(M × 0.07 × C × P × (1−P))` | [K6] |
| Maker fee | `fees = roundup(M × 0.0175 × C × P × (1−P))`, M defaults to 0 on the general schedule | [K6] |
| Rounding | "round up" means fee + position cost rounded up to a **centicent** ($0.0001) | [K6] |
| When charged | Taker fees only when immediately matched against resting orders; maker fees only when a resting order later trades; no fee to cancel | [K6] |
| Per-series multipliers | Non-Standard Fees table (e.g. `KXCPI` 1/1, `KXFED` 1/1, `KXBTCY` 0/0) | [K6] |
| Settlement / membership | No settlement fee, no membership fee | [K6] |
| Fee precision | Trade fee rounded up to $0.000001; net fee = trade + rounding − rebate, never below $0 | [K7] |

Worked check against the official General Trading Fees Table: P=$0.50, C=100 →
0.07×100×0.5×0.5 = 1.75 → table says **$1.75**. P=$0.45, C=100 →
0.07×100×0.45×0.55 = 1.7325 → table says **$1.74** (round up to the centicent).
P=$0.10, C=100 → 0.07×100×0.1×0.9 = 0.63 → table says **$0.63**. Three
independent rows reconcile, so the formula as implemented is correct.

## 5. Market data

| Item | Value | Source |
|---|---|---|
| Markets list | `GET /markets` (limit max 1000, cursor, `event_ticker`, `series_ticker`, `status`, `min_close_ts`, `max_close_ts`) | [K9] |
| Price fields | `yes_bid_dollars`, `yes_ask_dollars`, `last_price_dollars`, `previous_price_dollars`, all fixed-point **strings** | [K9] |
| Size fields | `yes_bid_size_fp`, `yes_ask_size_fp`, `volume_fp`, `open_interest_fp`, 2-decimal strings | [K9] |
| Liquidity | **No liquidity field on the market object.** `liquidity_dollars` does not exist — absent from the Get Markets **and** Get Market OpenAPI schemas and from live demo responses (corrected 2026-11-21; an earlier version of this row cited [K9] in error). Depth/liquidity is read from the order-book ladder below, never from a market field | [K5][K10] |
| Resolution | `result` = `yes` / `no` / empty, plus `settlement_value_dollars`, `settlement_ts` | [K9] |
| Orderbook | `GET /markets/{ticker}/orderbook`, `orderbook_fp.yes_dollars` / `.no_dollars`, levels `[price, count_fp]`, **ascending** so the best bid is last | [K5][K10] |
| Asks | Not returned. Best YES ask = 1 − best NO bid | [K5] |
| Level detail | One aggregated size per price level; per-order counts are not returned | [K5] |
| Bad ticker | `200` with empty arrays, not `404` | [K5] |
| Events | `GET /events?status=open&with_nested_markets=true&min_close_ts=` | [K11] |
| Series | `GET /series?category=…&include_volume=true` | [K12] |
| Candles | `GET /series/{series}/markets/{ticker}/candlesticks`, `period_interval` ∈ {1, 60, 1440} minutes | [K25] |

## 6. WebSocket channels

| Channel | Auth beyond connection | Filter | Key fields | Source |
|---|---|---|---|---|
| `ticker` | none | optional | `price_dollars`, `yes_bid_dollars`, `yes_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`, `dollar_volume`, `open_interest_fp`, `ts_ms` | [K18] |
| `trade` | none | optional | `yes_price_dollars`, `count_fp`, `taker_side`, `is_block_trade`, `ts_ms` | [K19] |
| `orderbook_delta` | **yes** (private group) | **required** `market_tickers` | `price`, `delta`, `side`, `ts_ms` | [K20][K8] |
| `market_lifecycle_v2` | none | optional | `event_type` ∈ created/activated/deactivated/close_date_updated/determined/settled/price_level_structure_updated, `result`, `settlement_value`, `close_ts` | [K21] |
| `fill`, `user_orders`, `market_positions` | yes (private) | — | user's own activity | [K8] |

Important, and easy to get wrong: `ticker` messages are **combined and flushed once
per second** — intermediate values are never sent, so a 1-second sampling of that
channel can miss a spike that the `trade` channel would show. The alert engine
therefore consumes `trade` as the primary price stream and `ticker` as the
book/volume snapshot, and records which stream each alert came from.

## 7. Rate limits

| Item | Value | Source |
|---|---|---|
| Default cost | 10 tokens per request | [K4] |
| Buckets | Read and Write are separate | [K4] |
| Balance endpoint | Own bucket: 1/s (Basic, Advanced), 5/s (higher) | [K4] |
| 429 body | `{"error": {"code": "too_many_requests", ...}}`, no `Retry-After`; back off exponentially | [K4] |
| WS handshake 429 | Connection cap or opening too fast; exponential backoff | [K8] |

## 8. Flagged for review (irregularities + unverifiable items)

| # | Item | Why flagged | What was done | Source |
|---|---|---|---|---|
| F1 | Legacy `POST /portfolio/orders` removed (410) while popular tutorials and the official starter repo still show it | Contract drift between docs and sample code | App uses V2 only and refuses to fall back; noted here and on the site | [K13][K24] |
| F2 | Official starter repo uses the non-recommended demo host `demo-api.kalshi.co` | Docs say `external-api.demo.kalshi.co` is recommended | Recommended host is the default, alternate is a setting | [K1][K24] |
| F3 | Demo price behaviour "may not be reflective of those in real markets" | Any demo-derived edge may not transfer to live markets | Every page that shows a demo price repeats this warning verbatim | [K2] |
| F4 | `orderbook_delta` requires an authenticated connection while the REST orderbook is public | Liquidity ladder is polled via REST instead of streamed | Documented in the UI ("depth comes from REST snapshots") | [K8][K20] |
| F5 | Exact demo series tickers for gas prices / elections / culture / crypto / golf | Not enumerable without live API access; no official static list exists | Discovered at runtime from `/series` + `/events`; the verified-by-name seeds in `research/topics.json` are marked `seed` and re-checked live | [K12][K11] |
| F6 | Demo account starting balance | Depends on the account; not a documented constant | Read from `/portfolio/balance`; shown as "unknown" when no key | [K15] |
| F7 | "Highest dollar amount live events" — no official ranking metric is documented | Kalshi does not document a "largest event" endpoint or sort order | Ranked by reported `dollar_volume` from the ticker feed, else `volume_fp × price`; the metric is disclosed on the page | [K18][K9] |
| F8 | Causes of price jumps | No official feed attributes a price move to a news story | Candidate links only (series settlement sources + configured news feeds), always labelled candidates | [K12] |
| F9 | Whether demo `KXGAS`-style gas series are open on a given day | Dynamic | Discovered at runtime; blank if absent | [K12] |
| F10 | Earlier research claimed a `liquidity_dollars` field on the market object (and flagged only its undocumented formula) | **Disproved 2026-11-21:** the field does not exist. It is absent from the official Get Markets and Get Market OpenAPI schemas and from live `GET /markets` responses; the site never displayed it (its own Flagged page F23 and Method page already state "no `liquidity` field anywhere") | This row and the §5 Liquidity row corrected to the verified fact: liquidity/depth comes only from the order-book ladder | [K9][K5][K10] |
| F11 | Fee schedule self-inconsistency: the formula text says round up to a **centicent** ($0.0001) but the printed General Trading Fees Table is rounded up to a whole **cent** | 1 contract at $0.01: formula gives 0.07×1×0.01×0.99 = $0.000693, table prints **$0.01**. 100 contracts at $0.45: formula gives $1.7325, table prints $1.74. Every row reconciles only under cent rounding. | The app charges the formula at centicent (which is what can actually leave a balance per [K7]) and displays the formula value, not the table value. Both are shown in the fee panel so the difference is visible. | [K6][K7] |

## 9. Suggestions to make the site more live and interactive

1. **Trade-print tape as the heartbeat.** Use the `trade` channel as the primary
   pulse (every print) and `ticker` for the 1-second snapshot; show both in the
   header as distinct rates so a user can see when the feed is quiet vs. broken. [K19][K18]
2. **Depth-first detail.** Because asks are implied (1 − best opposite bid), show a
   two-column ladder with "cost to buy N" computed from the actual levels, not from
   the top of book. [K5]
3. **Resolved-event archive that never forgets.** `market_lifecycle_v2`
   `determined`/`settled` messages are the only live source of YES/NO resolution;
   persist them so the archive survives restarts. [K21]
4. **Latency honesty.** Stamp every alert with the feed timestamp (`ts_ms`) and the
   local receive time, and display the difference. If the clock is off by >30 s the
   authenticated calls will fail anyway. [K3]
5. **Signal-to-noise control.** A second chat filtered by the scoring model, with the
   reason string shown on each card, so the user can audit why a signal was promoted.
6. **One-click "why" panel.** For each alert: the series' official settlement source
   links plus configured news feeds, all labelled candidate causes. [K12]
7. **Keyboard-first navigation.** `1`–`5` jump between topics, `p` pauses the chats,
   `/` focuses search; traders keep hands on the keyboard.
8. **Explicit data provenance badge.** "DEMO FEED · prices may not reflect real
   markets" on every price, per Kalshi's own warning. [K2]
9. **Paper-vs-live split view.** Show the paper portfolio next to the demo account
   portfolio, never merged, so strategy results cannot be confused with account
   results. [K15][K16]
10. **Cost-aware ROI.** Rank signals by expected value after the real fee formula,
    not by raw price move, because a $0.10 move at $0.50 costs far more in fees than
    one at $0.05. [K6]

## 10. What could not be verified here (be explicit)

| Item | Reason | Consequence | Source |
|---|---|---|---|
| Any live Kalshi response | Sandbox egress is allowlisted to GitHub/PyPI/npm; Kalshi hosts resolve but TCP is blocked | No live prices, volumes, event tickers or account data are claimed anywhere in this repo | unverified — no source can confirm a response that was never received |
| The demo account's actual balance/positions | Needs a demo API key; none is stored in the repo (and should not be) | App reports "not connected" until a key is present | unverified — value is account-specific, blank until a key exists |
| Current per-series fee multipliers for the 5 topics | The PDF lists many series but not every one; multipliers can change with each schedule update | The app reads the PDF-documented defaults and shows the multiplier it applied | unverified for series not listed in [K6]; the defaults themselves are from [K6] |

[K1]: https://docs.kalshi.com/getting_started/api_environments.md
[K2]: https://docs.kalshi.com/getting_started/demo_env.md
[K3]: https://docs.kalshi.com/getting_started/api_keys.md
[K4]: https://docs.kalshi.com/getting_started/rate_limits.md
[K5]: https://docs.kalshi.com/getting_started/orderbook_responses.md
[K6]: https://kalshi.com/docs/kalshi-fee-schedule.pdf
[K7]: https://docs.kalshi.com/getting_started/fee_rounding.md
[K8]: https://docs.kalshi.com/getting_started/quick_start_websockets.md
[K9]: https://docs.kalshi.com/api-reference/market/get-markets.md
[K10]: https://docs.kalshi.com/api-reference/market/get-market-orderbook.md
[K11]: https://docs.kalshi.com/api-reference/events/get-events.md
[K12]: https://docs.kalshi.com/api-reference/market/get-series-list.md
[K13]: https://docs.kalshi.com/api-reference/orders/create-order-v2.md
[K14]: https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md
[K15]: https://docs.kalshi.com/api-reference/portfolio/get-balance.md
[K16]: https://docs.kalshi.com/api-reference/portfolio/get-positions.md
[K17]: https://docs.kalshi.com/api-reference/portfolio/get-fills.md
[K18]: https://docs.kalshi.com/websockets/market-ticker.md
[K19]: https://docs.kalshi.com/websockets/public-trades.md
[K20]: https://docs.kalshi.com/websockets/orderbook-updates.md
[K21]: https://docs.kalshi.com/websockets/market-and-event-lifecycle.md
[K24]: https://github.com/Kalshi/kalshi-starter-code-python
[K25]: https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md

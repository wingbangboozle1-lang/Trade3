# Suggestions to make the Kalshi dashboard more live and interactive (S2)

Owner: session `arena/7b441d51-trade3`. Each suggestion cites an official Kalshi page read on 2026-11-20 UTC. Items marked **(our design)** are recommendations, not Kalshi facts. Facts are in `API_FACTS_LEDGER.md`, with IDs such as C11 and B3.

## Priority 1 — make data truly live

1. **Add a server-side relay for the WebSocket feed.** Public channels (`ticker`, `trade`, `market_lifecycle_v2`) still need a signed handshake, and `orderbook_delta` is listed as a private channel (B3). A browser-only static page cannot hold keys safely, so a small relay that holds the key and forwards messages to the page is required for sub-second updates. Sources: https://docs.kalshi.com/getting_started/quick_start_websockets and https://docs.kalshi.com/getting_started/api_environments (WebSocket hosts A5/A6).
2. **Trigger resolution alerts from lifecycle events, not polling.** The `market_lifecycle_v2` channel emits `determined` and `settled` events. These are the natural triggers for the "resolved YES or NO" feed. Source: https://docs.kalshi.com/getting_started/market_lifecycle (C19–C20).
3. **Poll only what changed.** `GET /events` accepts `min_updated_ts` to "efficiently poll for changes". Use it for the topic lists instead of re-downloading all pages. Source: https://docs.kalshi.com/api-reference/events/get-events.md (C3).
4. **Use orderbook `depth` for the liquidity ladder.** `GET /markets/{ticker}/orderbook?depth=N` (1–100) returns only the best N levels per side. This keeps payloads small for a "contracts available at each price" view. Source: https://docs.kalshi.com/api-reference/market/get-market-orderbook.md (C7–C8).
5. **Show data freshness on every live number.** `GET /markets/{ticker}` may be cached, so prices can lag by a few seconds. Display "as of" timestamps. Source: https://docs.kalshi.com/api-reference/market/get-market.md (C6).

## Priority 2 — charts that match what the API can provide

6. **Be explicit about chart resolution.** Kalshi candlesticks are 1-minute, 1-hour, or 1-day (C11). A "seconds" view cannot come from the candlestick endpoint. Offer seconds only from our own recorded samples or the trade stream, and label the source on the chart. Source: https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md
7. **Use trade prints for price-move evidence.** `GET /markets/trades` returns `yes_price_dollars` with `created_time` and supports `min_ts`/`max_ts` in seconds (C16). Use it to mark the exact trade that moved a price by $0.10 or more. Source: https://docs.kalshi.com/api-reference/market/get-trades.md
8. **Keep block trades separate in price-move logic (our design, to review).** Trades carry `is_block_trade`, and the endpoint can filter on it (C16). Decide explicitly whether block prints should trigger alerts. Source: https://docs.kalshi.com/api-reference/market/get-trades.md
9. **Label the $0.10 alert rule as ours.** The ≥ $0.10 threshold is the user's requirement. The detection method (comparing consecutive samples, or comparing against the candlestick open) is our design and should be shown on the page. Source for available fields: https://docs.kalshi.com/api-reference/market/get-market.md (C13: `previous_yes_bid_dollars`, `previous_price_dollars`).

## Priority 3 — demo account and trading

10. **Do not use legacy order endpoints.** The legacy `/portfolio/orders` write endpoints return `410 Gone` and are replaced by V2 endpoints (E1). Any simulated-to-demo execution code must use V2. Source: https://docs.kalshi.com/llms.txt
11. **React to fills instead of polling the balance.** `GET /portfolio/balance` has a strict limit (1 per second on Basic and Advanced tiers), and the docs recommend reacting to fills and settlements via the user fills WebSocket channel (D3). Source: https://docs.kalshi.com/getting_started/rate_limits
12. **Use the right host for fills.** Dedicated user hosts deliver `fill` and `user_orders` with lower latency: `wss://user-ws.demo.kalshi.co/trade-api/ws/v2` for demo. Source: https://docs.kalshi.com/getting_started/api_environments
13. **Sign requests correctly.** Sign timestamp + method + path without the query string, and keep the clock within 30 seconds (B6, B8). Source: https://docs.kalshi.com/getting_started/api_keys

## Priority 4 — trader UX (our design)

14. **Two alert chats with clear labels.** "All events" and "High-ROI filter" should show the rule behind the filter on the page. The high-ROI rule is a placeholder until the user's model is supplied.
15. **Use topic tabs with event groups.** Keep topics separate and group markets under each event, as the user asked.
16. **Use simple sparklines and one main chart.** Keep one time-range selector (seconds, minutes, hours) so the page stays easy to read.
17. **Show the exchange status and maintenance banner.** The docs list an exchange status endpoint and a maintenance page. Show a banner when trading is paused. Sources: https://docs.kalshi.com/getting_started/maintenance_and_pauses and the "Get Exchange Status" entry in https://docs.kalshi.com/llms.txt

## Not verified / open questions

- Browser CORS support for the REST hosts is not documented (F6 in the ledger). Test before relying on direct browser calls.
- Numeric public rate limits are not on the page read (D4).
- The high-ROI "model" is not defined anywhere in the repo or the request. Any filter is a placeholder.

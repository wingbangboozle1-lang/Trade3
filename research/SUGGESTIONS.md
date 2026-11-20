# Suggestions: making the dashboard more live, more interactive, and easier to trade from

Ranked by expected usefulness per hour of work. Each item names the documented
behaviour it depends on, so none of it is speculative about what the API can do.

## Tier 1 — do these first

| # | Suggestion | Why it helps a trader | Depends on (source) |
|---|---|---|---|
| 1 | **Make the trade tape, not the ticker, the heartbeat.** Show a "prints/sec" and an "exchange clock lag" readout in the header, side by side. | `ticker` flushes once per second and drops intermediate values, so a quiet ticker can mean "no change" *or* "a burst we will never see". A trade-rate readout tells you which. | [K18](https://docs.kalshi.com/websockets/market-ticker.md), [K19](https://docs.kalshi.com/websockets/public-trades.md) |
| 2 | **Price the ladder as "cost to buy N", not just top-of-book.** A slider for N (10/100/500 contracts) that walks the actual levels and returns the average fill price and the slippage versus touch. | Top-of-book size overstates liquidity. The orderbook returns aggregated size per level, so the walk is exact and cheap to compute. | [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md) |
| 3 | **Split every alert into "what moved" and "what it cost to act on it".** Two numbers on the card: the move in cents, and the round-trip cost in cents at that moment (half-spread + fees both ways). | A 10-cent move on a 12-cent spread is not tradable. Putting the cost next to the move makes that instant. | [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md), [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| 4 | **Persist the resolution log and the paper ledger to disk.** JSONL append, replay on boot. | Right now a restart loses the archive. A resolution log is the one thing that cannot be recomputed later. | [K21](https://docs.kalshi.com/websockets/market-and-event-lifecycle.md) |
| 5 | **Show adverse selection on every strategy card.** Percentage of maker fills that occurred at a price worse than the contemporaneous mid. | It is the honest counterweight to a maker strategy's headline edge, and the app already computes it. | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |

## Tier 2 — high value, more work

| # | Suggestion | Why it helps | Depends on (source) |
|---|---|---|---|
| 6 | **Event-level thesis view.** For each event, one row per market with YES price, and an explicit "sum of YES prices" against $1.00 for mutually exclusive events. Colour only when the deviation exceeds fees. | In a mutually exclusive event the legs must sum to ≤ $1.00. That is a checkable structural fact, not a forecast. | [K11](https://docs.kalshi.com/api-reference/events/get-events.md) |
| 7 | **Quote-quality decay.** For each market, plot time since the last print against the spread. Wide book + stale print is a different risk from wide book + active print. | Distinguishes illiquidity from a genuinely quiet market, which matters before sizing. | [K18](https://docs.kalshi.com/websockets/market-ticker.md) |
| 8 | **Alert replay with a scrubber.** Replay any 10-minute window of alerts at 1×/10×/60× with the chart in sync. | Turns the alert feed into something reviewable after the fact, instead of a wall you had to be watching. | [K19](https://docs.kalshi.com/websockets/public-trades.md) |
| 9 | **Backtest mode over candles.** Build the same signal on `candlesticks` history instead of the live stream, then compare signal counts per day across topics. | Second-order validation: does the maker edge survive more than one afternoon of data? Candles are the only historical source that does not need a full tape. | [K25](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) |
| 10 | **Per-series fee badge on every row.** Show the multiplier the fee model actually applied, and whether it came from the schedule table or the default. | Kalshi's schedule has per-series multipliers (some are 0×/0×). A silent default is a silent surprise in P&L. | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |

## Tier 3 — polish that traders notice

| # | Suggestion | Why it helps | Depends on (source) |
|---|---|---|---|
| 11 | **Keyboard-first navigation.** `1`–`5` for topics, `l/p/r/s` for tabs, `/` to search, `space` to pause both feeds. | Already implemented; keep it and document it on screen with a `?` overlay. | [K8](https://docs.kalshi.com/getting_started/quick_start_websockets.md) |
| 12 | **One-screen "state of the book" strip.** For the selected market: last, bid, ask, spread, depth each side, time to close, and the last alert. Six numbers, no scroll. | Traders need one glance, not a scroll. | [K9](https://docs.kalshi.com/api-reference/market/get-markets.md) |
| 13 | **Separate "candidate cause" links from "settlement source" links visually.** Two different kinds of evidence should not look identical. | A settlement source is authoritative for resolution; a news feed is only a hint about why a price moved. | [K12](https://docs.kalshi.com/api-reference/market/get-market-series-list.md) |
| 14 | **Explicit "no key" and "key present but rejected" states.** Different colours, different words, with the exact error code. | Turns a silent failure into a fixable one; `header_timestamp_expired` in particular looks like a permissions bug and is not. | [K3](https://docs.kalshi.com/getting_started/api_keys.md) |
| 15 | **Alert-density strip.** One bar per minute showing how many alerts fired, so you can see whether the market is hot without reading the feed. | Cheap to compute, immediately readable. | [K19](https://docs.kalshi.com/websockets/public-trades.md) |
| 16 | **A "why is this empty?" affordance on every panel.** The exact endpoint that returned nothing and the query used. | The most common support question on a dashboard is "why is this blank". | [K23](https://docs.kalshi.com/api-reference/exchange/get-exchange-status.md) |

## Things that would look good and be wrong

These are deliberately not built. They are listed so nobody adds them later thinking
they are missing:

| Anti-pattern | Why it is wrong |
|---|---|
| Showing per-order sizes in the book | The API returns aggregated size per price level only. Per-order data does not exist. [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md) |
| Sampling `ticker` at 100 ms to "catch spikes" | The channel drops intermediate values; the extra sampling adds latency, not information. Use `trade`. [K18](https://docs.kalshi.com/websockets/market-ticker.md) |
| Treating demo prices as real market prices | Kalshi states demo behaviour may not reflect real markets. [K2](https://docs.kalshi.com/getting_started/demo_env.md) |
| Claiming a news story "caused" a move | No official feed attributes price moves to stories. Candidate links are labelled as candidates. [K12](https://docs.kalshi.com/api-reference/market/get-series-list.md) |
| Ranking strategies on 3 trades | Sample-size theatre. The UI flags anything under 10 trades as thin and refuses to rank it. [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| Summing balance and portfolio value into one "equity" number and calling it the account value | They are two documented fields. Reported side by side, never merged. [K15](https://docs.kalshi.com/api-reference/portfolio/get-balance.md) |
| Using `POST /portfolio/orders` because a tutorial does | It returns 410. [K13](https://docs.kalshi.com/api-reference/orders/create-order-v2.md) |
| Polling `/portfolio/balance` in a loop | It has its own tight bucket (1/s on the lower tiers) and only changes on fills, settlements and transfers. React to fills instead. [K4](https://docs.kalshi.com/getting_started/rate_limits.md) |

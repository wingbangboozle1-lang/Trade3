# Executive summary

**What this is.** A working, documented system for watching Kalshi's **demo** exchange,
limited to five topics (gas prices, elections, culture, crypto, golf), that flags every
contract-price move of **$0.10 or more** in either direction, publishes those flags to two
live scrolling feeds, follows each market to its **YES/NO** resolution, and runs four
simulated strategies against the same signals so their results can be compared rather than
assumed. Everything it claims about Kalshi is traceable to a Kalshi-owned source; see
[Sources](sources.html).

**What it is not.** It is not a live-trading bot, and it is not connected to your demo
account in this repository (no key can be committed, and should not be). The order path is
implemented against the official V2 contract and is exercised against a documented mock;
it activates only when you supply a demo key at runtime.

---

## The five things worth knowing

| # | Finding | Why it matters | Source |
|---|---|---|---|
| 1 | The legacy order endpoint `POST /portfolio/orders` **returns 410 Gone**. Orders must go to `POST /portfolio/events/orders` (V2) with `side` = `bid`/`ask`, fixed-point `count` and `price`, and an explicit `self_trade_prevention_type`. | Most public Kalshi tutorials, and Kalshi's own Python starter repo, still show the removed path. A bot built from those samples cannot place an order. | [K13](https://docs.kalshi.com/api-reference/orders/create-order-v2.md) |
| 2 | The `ticker` WebSocket channel is **flushed once per second** and explicitly does not send intermediate values. | Sampling only `ticker` will miss a 10-cent spike entirely. The alert engine therefore treats the `trade` channel (every print) as its price stream. | [K18](https://docs.kalshi.com/websockets/market-ticker.md), [K19](https://docs.kalshi.com/websockets/public-trades.md) |
| 3 | The orderbook endpoint returns **bids only** for both sides, with one aggregated size per price level. Asks are implied: best YES ask = 1 − best NO bid. | "How many contracts are available at a given price" has to be derived from the opposite side, and per-order counts simply do not exist. Anything that shows them is inventing them. | [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md) |
| 4 | Taker fee = `roundup(M × 0.07 × C × P × (1−P))`; maker fee = `roundup(M × 0.0175 × C × P × (1−P))` with maker `M` **defaulting to 0**. | Trading fees are charged only on the immediate match, so a resting order that later fills at a 0× multiplier costs nothing. That asymmetry is the only structurally positive-expectation trade in this design. | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| 5 | Fading a 10-cent move as a **taker** has negative expected value, always: you pay the ask to reach a mid that is half a spread better. | A "high ROI" feed that promotes every 10-cent move is promoting a guaranteed loss. The model in this project promotes only the **maker** view, and keeps the taker view visible as a labelled control. | arithmetic on [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md) + [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |

---

## Endpoints in use (verified)

| Surface | URL | Status | Source |
|---|---|---|---|
| REST, demo (default) | `https://external-api.demo.kalshi.co/trade-api/v2` | Recommended by Kalshi | [K1](https://docs.kalshi.com/getting_started/api_environments.md) |
| REST, demo (alternate) | `https://demo-api.kalshi.co/trade-api/v2` | Documented as also supported | [K1](https://docs.kalshi.com/getting_started/api_environments.md), [K24](https://github.com/Kalshi/kalshi-starter-code-python) |
| WebSocket, demo (default) | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | Recommended by Kalshi | [K1](https://docs.kalshi.com/getting_started/api_environments.md), [K8](https://docs.kalshi.com/getting_started/quick_start_websockets.md) |
| WebSocket, demo (alternate) | `wss://demo-api.kalshi.co/trade-api/ws/v2` | Documented as also supported | [K1](https://docs.kalshi.com/getting_started/api_environments.md) |

Both hosts are implemented and selectable. The recommendation, not the alternate, is the
default. Source: [K1](https://docs.kalshi.com/getting_started/api_environments.md).

---

## Architecture at a glance

| Layer | What it does | Key detail | Source |
|---|---|---|---|
| Discovery | `GET /series`, `GET /events?with_nested_markets=true`, `GET /markets` | Classifies into exactly five topics; unmatched markets are excluded, never guessed | [K12](https://docs.kalshi.com/api-reference/market/get-series-list.md), [K11](https://docs.kalshi.com/api-reference/events/get-events.md), [K9](https://docs.kalshi.com/api-reference/market/get-markets.md) |
| Price ingest | WebSocket `trade` + `ticker` | Prints drive alerts; snapshots drive book/volume context | [K19](https://docs.kalshi.com/websockets/public-trades.md), [K18](https://docs.kalshi.com/websockets/market-ticker.md) |
| Depth | `GET /markets/{ticker}/orderbook` | Polled, because `orderbook_delta` requires an authenticated connection | [K10](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md), [K20](https://docs.kalshi.com/websockets/orderbook-updates.md) |
| Alerts | Consecutive-print and within-window detectors, both at ≥$0.10 | Cooldown per market; every alert stores both observations | [K19](https://docs.kalshi.com/websockets/public-trades.md) |
| Model | Maker vs taker expected value, after official fees | Promotes only positive-EV conditions; records every gate and reason | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf), [K5](https://docs.kalshi.com/getting_started/orderbook_responses.md) |
| Paper trading | Four strategies, integer-tick ledger, official fees | Maker intents fill only if a later print crosses the limit | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf), [K7](https://docs.kalshi.com/getting_started/fee_rounding.md) |
| Resolution | `market_lifecycle_v2` `determined`/`settled` | Captures YES/NO and settlement value; settles paper positions at par | [K21](https://docs.kalshi.com/websockets/market-and-event-lifecycle.md) |
| Broker | `POST/DELETE /portfolio/events/orders` | Demo only by default; local order-count and daily-notional caps; JSONL audit log | [K13](https://docs.kalshi.com/api-reference/orders/create-order-v2.md), [K14](https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md) |

---

## What was verified, and what was not

| Claim | Verified? | Evidence |
|---|---|---|
| Demo and production hosts | Yes | [K1](https://docs.kalshi.com/getting_started/api_environments.md) |
| Signature construction (timestamp + method + path, no query) | Yes | [K3](https://docs.kalshi.com/getting_started/api_keys.md) |
| 30-second clock tolerance | Yes | [K3](https://docs.kalshi.com/getting_started/api_keys.md) |
| Fee formulas and rounding | Yes | [K6](https://kalshi.com/docs/kalshi-fee-schedule.pdf), [K7](https://docs.kalshi.com/getting_started/fee_rounding.md) |
| 410 on the legacy order path | Yes | [K13](https://docs.kalshi.com/api-reference/orders/create-order-v2.md) |
| Tick size of 1 cent | Yes, as the general structure; individual markets can declare a different `price_level_structure` | [K9](https://docs.kalshi.com/api-reference/market/get-markets.md) |
| Any live price, volume or account balance | **No.** This build environment could not reach Kalshi (egress is restricted to GitHub, PyPI and npm). No live value is claimed anywhere. | unverified — no response was ever received, so no value is printed |
| Which golf series exist | **No.** No official static list was retrievable; discovery is dynamic at runtime. | unverified — blank until a live `/series` response lists it |
| Definition of `liquidity_dollars` | **No.** The field exists; its formula is not documented on the pages retrieved. Shown as reported. | [K9](https://docs.kalshi.com/api-reference/market/get-markets.md) |

---

## The model, in one paragraph

A sharp move makes one side expensive. Buying that side back as a **taker** costs the ask
and earns the mid, so it loses half the spread plus the taker fee every time — that is
arithmetic, not a market view. Resting a **bid** on the side that got cheaper earns the
half-spread instead, and at a 0× maker multiplier it keeps it. The model therefore scores
the maker view, requires the move to be at least twice the observed spread (so the move is
signal, not noise), requires at least 1.5% expected edge on capital, requires two-sided
depth of at least 25 contracts, and refuses anything closing inside a minute. Every
promotion prints its inputs. The measured cost of this view — adverse selection, i.e. fills
that cluster when the market is already moving against you — is tracked separately and
reported rather than averaged away.

---

## Bottom line

- The **alerting** requirement is met exactly as specified: ≥$0.10, either direction, two
  scrolling feeds, one of them filtered by a scored, auditable model.
- The **resolution** requirement is met from the only live source that carries it
  (`market_lifecycle_v2`).
- The **simulated trading** requirement is met with four strategies and a per-category
  analytics breakdown; the maker/taker comparison is the headline result and it is a
  caution, not a promise.
- The **verification** requirement is met structurally: every table row on this site carries
  a source ID that resolves to a Kalshi-owned URL, and a build step fails if a row is
  published without one. Unverifiable values are blank and appear on the
  [Flagged for review](flagged.html) page.
- The **live dashboard** runs from `app/` (`npm start`). It cannot be a static GitHub Pages
  page, because a static page cannot hold a private key or keep a WebSocket open. That
  constraint is stated on the site rather than worked around with fake data.

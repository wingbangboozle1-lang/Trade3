# Trade3 — Kalshi demo dashboard

> **Repository state:** this repo contains **two independent builds** of the Kalshi demo dashboard, both verified
> against official Kalshi sources, integrated side by side rather than one replacing the other:
>
> | | Where | What it is |
> |---|---|---|
> | **Build A** | [`docs/index.html`](docs/index.html) · [`docs/dashboard.html`](docs/dashboard.html) | Static browser-side dashboard: live REST polling straight from the browser, topic pages under `docs/topics/`, Python offline simulator (`strategies.py`, `backtest.py`, `run_sim.py`). |
> | **Build B** | [`docs/dashboard-site/index.html`](docs/dashboard-site/index.html) · [`app/`](app/index.html) · [`server/`](server) | Server-side collector with three explicit data modes, swing engine, dual alert feeds, canvas charts, resolution tracking, paper strategies, plus an executive summary, requirements traceability, consolidated sources and flagged-review pages. |
>
> They do not conflict: Build A lives at `docs/*`, Build B at `docs/dashboard-site/*`, and both link to each other.
> `COORDINATION.md` records which session built what, and the verification performed for each.



A live event dashboard for the **Kalshi demo environment**, covering five topics only — **gas prices, elections,
culture, crypto and golf** — with $0.10 swing alerts, two scrolling alert feeds, interactive price charts,
order-book liquidity, yes/no resolution tracking and simulated strategy trading.

Everything here is source-audited. Every value on the published site links to the official Kalshi endpoint it came
from, and anything the API did not return is left blank and marked *unverified* rather than inferred.

- **Published site (Build B):** [`docs/dashboard-site/`](docs/dashboard-site/index.html) — static, no build step, deploys to GitHub Pages
- **Live dashboard (Build B):** `app/` — served by the collector at `/app/`
- **Executive summary:** [docs/dashboard-site/executive-summary.html](docs/dashboard-site/executive-summary.html)
- **Flagged for review:** [Build B](docs/dashboard-site/flagged.html) · [Build A](docs/flagged.html)

## Quick start

```bash
# Node 20+. Zero npm dependencies.
npm start
#   dashboard  http://localhost:3000/app/
#   site       http://localhost:3000/
#   API        http://localhost:3000/api/state
```

### Data modes

The collector can run in three modes and always says which one it is using, in the pill at the top right of the
dashboard:

| Mode | What it means | How to enable |
|---|---|---|
| `live` | Reads the Kalshi demo API on every poll. The real thing. | `DATA_MODE=live` (default) |
| `snapshot` | Replays a committed capture of **real** demo values. Truthful but frozen, so no new swings fire. | `DATA_MODE=snapshot` |
| `demo` | **Synthetic** prices generated locally so the pipeline can be demonstrated when Kalshi is unreachable. Every ticker is `DEMO-…` and every title starts with `[DEMO]`. Not market data. | `DATA_MODE=demo` |

With `DATA_MODE=live` and `ALLOW_DEMO_FALLBACK=0`, the app reports failure instead of quietly switching to synthetic
data.

### Reading your real demo portfolio (read-only)

```bash
export KALSHI_API_KEY_ID="your-demo-key-id"
export KALSHI_PRIVATE_KEY_PATH="./kalshi-demo-key.pem"
npm start
```

Demo keys only work against demo hosts and production keys only against production hosts. Create the key in the
[demo UI](https://demo.kalshi.co/) under Account & Settings → API Keys. This project signs requests locally; the
private key is never sent anywhere except as a signature to Kalshi.

## What it does

| Feature | Detail |
|---|---|
| Topic routing | Five topics, driven by Kalshi's own series `category`, `tags` and `product_metadata.scope` |
| Swing alerts | Inclusive **≥ $0.10** in either direction, compared in integer 1/10000-dollar space |
| Two alert bases | `tick` (previous poll) and `day` (Kalshi's `previous_price_dollars`) reported separately |
| Dual feeds | All swings, and only swings the model scores ≥ 45, with every score input printed |
| Charts | Time on X, contract price on Y, switchable between seconds / minutes / hours |
| Liquidity | Depth ladder with contracts and dollar notional per price level |
| Resolutions | Tracks each market until Kalshi publishes `result` = yes/no, recorded once with its source |
| Simulated trades | Four documented strategies, explicit entries and exits, results grouped by strategy type |
| Demo portfolio | Read-only `GET /portfolio/balance` and `/portfolio/positions` when a key is configured |

## Tests

```bash
node tests/smoke-test.js        # 13 checks: engine, routing, fees, settlement, all HTTP routes, all data modes
node tests/site-render-test.js  # 13 checks: every page script renders real content, no "undefined"
node scripts/check-links.js     # 0 broken local links, anchors, imports or DOM targets
```

## Verification notes

The API facts this project depends on were read from the official documentation before any code was written, then
confirmed against the live demo API. The findings that changed the design:

- **There is no `Gas` and no `Golf` category on Kalshi.** `GET /series?category=Gas` and `?category=Golf` both return
  `{"series":null}`. Gas lives in `Economics` with the tag `Oil & Gas`; golf lives in `Sports` with the tag `Golf`.
- **Demo prices are not production prices.** Kalshi states the demo "may not be reflective of those in real markets".
- **Legacy order endpoints are gone.** `POST /portfolio/orders` returns `410 deprecated_v1_order_endpoint`; orders use
  `POST /portfolio/events/orders`.
- **The fee formula is verifiable.** `fees = round up(M × 0.07 × C × P × (1 − P))` matches all 21 rows of Kalshi's own
  published table to within two cents.

Full list, with evidence links: [Flagged for Review](docs/flagged.html).

## Repository layout

```
server/          collector, Kalshi client, swing engine, paper trading, HTTP API
app/             dashboard UI (no framework, no build step)
docs/            published static site (GitHub Pages source)
data/            committed snapshot of real demo values + gitignored runtime state
tests/           offline test harnesses
scripts/         link checker
.github/         Pages deploy workflow
COORDINATION.md  shared task board for parallel agent sessions
```

## Licence

MIT.

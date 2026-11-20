# Trade3 — Kalshi live dashboard, alerts & simulated trading

> **Repository state.** Two verified builds coexist and are cross-linked, neither discarded:
>
> | | Where | What it is |
> |---|---|---|
> | **Build A** (this README) | `docs/` + Python toolkit | Static browser-side dashboard published to GitHub Pages: live REST polling, topic pages, $0.10 swing alerts, charts, liquidity, resolutions, simulated strategies. Re-verified row by row by session `arena/4f9f13c8-trade3`. |
> | **Build B** | `docs/dashboard-site/` · `app/` · `server/` | Node collector + dashboard with three explicit data modes (`live` / `snapshot` / `demo`), served by `npm start`. Built by session `arena/63ad86b3-trade3`; see the board below for its verification record. |
>
> `COORDINATION.md` records who built what, what was verified, and every irregularity.


A static site plus a small Python toolkit for tracking **gas prices, elections, culture, crypto and
golf** on Kalshi. It ranks the biggest-dollar live events, streams two alert feeds for any contract
moving **≥ $0.10**, charts price against time, shows order-book liquidity, follows contracts through
to their yes/no resolution, and simulates four fixed trading strategies whose results are broken down
by topic and by strategy.

Everything published traces to an official Kalshi source. Where a value cannot be confirmed it is
left **blank** and listed on the [Flagged for review](docs/flagged.html) page.

- **Live site:** `docs/` → GitHub Pages (`https://wingbangboozle1-lang.github.io/Trade3/`)
- **Start here:** [docs/index.html](docs/index.html) · dashboard · [executive summary](docs/executive-summary.html)
- **Evidence:** [verification log](docs/verification.html) · [VERIFICATION.md](VERIFICATION.md) · [methodology](docs/methodology.html)

## Preview locally

```bash
python3 -m http.server 8000 --directory docs
# http://localhost:8000/            landing page
# http://localhost:8000/dashboard.html
```

The dashboard calls Kalshi's public REST API straight from the browser — no key, no build step, no
manual input. Demo is the default environment; production is read-only market data.

## Checks (also run in CI on every push)

```bash
python scripts/check_site.py       # broken links, JS syntax, data integrity, no localhost refs
node tests/logic.test.mjs          # order-book maths, ROI screen, candle intervals, formatting
node tests/render.test.mjs         # page scripts in a headless DOM (npm i --no-save jsdom)
python scripts/verify_series.py    # re-fetch all 37 series rows and diff them (needs outbound HTTPS)
python -m py_compile kalshi_client.py strategies.py backtest.py run_sim.py
```

## Python toolkit

```bash
pip install -r requirements.txt

# paper-trading simulation over live demo data (no key needed)
python run_sim.py --polls 6 --interval 20            # writes sim_output.json + per-strategy CSVs

# authenticated demo calls need your own demo key — never committed, never entered in the site
export KALSHI_API_KEY_ID=...            # demo.kalshi.co → Account & security → API keys
export KALSHI_PRIVATE_KEY_PATH=./kalshi-key.pem
python -c "from kalshi_client import KalshiClient; print(KalshiClient().balance())"
```

`KalshiClient.place_order` builds the documented V2 order body and **defaults to `dry_run=True`**;
sending a real demo order requires `dry_run=False` *and* `KALSHI_ALLOW_ORDERS=1`.

## Layout

```
docs/                    GitHub Pages site
  index.html             landing page + topic tables
  dashboard.html         live dashboard (alerts, charts, liquidity, resolutions)
  portfolio.html         strategy lab, P&L by topic/strategy, CSV/JSON export
  executive-summary.html requirement → implementation map
  methodology.html       endpoints, field names, thresholds, network options
  verification.html      row-by-row verification with API links
  flagged.html           unverified / judgement-call items
  topics/*.html          one page per topic, verified series + live contracts
  data/series.json       37 verified series rows, each with its API proof URL
  assets/                app.js (core), dashboard.js, portfolio.js, topic.js, style.css
scripts/check_site.py    static-site gate used by CI
scripts/verify_series.py re-verifies every published series row
tests/logic.test.mjs     offline unit tests of the dashboard maths
tests/render.test.mjs    headless-DOM render tests for every page (45 checks)
kalshi_client.py         REST client, documented signing and V2 order body
strategies.py            four strategy rules + the high-ROI screen
backtest.py              paper portfolio, settlement, CSV export
run_sim.py               live paper-trading simulation CLI
```

## Documentation set

| File | What it covers |
|------|----------------|
| [docs/executive-summary.html](docs/executive-summary.html) | Requirements → implementation, with the caveats stated per row |
| [docs/methodology.html](docs/methodology.html) | Endpoints, field names, alert and chart maths, network fallbacks |
| [docs/verification.html](docs/verification.html) | Every series row with the official API record that proves it |
| [docs/flagged.html](docs/flagged.html) | Ten items that need a human decision |
| [VERIFICATION.md](VERIFICATION.md) | Repo-side verification record and irregularities |
| [COORDINATION.md](COORDINATION.md) | Session task board, claims, merge record |

Not financial advice. Kalshi demo markets use mock funds and their prices may not reflect real markets.

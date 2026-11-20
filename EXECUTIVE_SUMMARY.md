# Executive Summary — Trade3 Kalshi Demo Dashboard

**Date:** 2026-11-20 · **Environment:** Kalshi demo (mock funds) · **Site:** GitHub Pages (`docs/`)

## What was built

A live, zero-setup dashboard that tracks **gas prices, elections, culture, crypto and golf only**,
ranks the highest-dollar events, alerts on ≥ $0.10 contract-price swings in two scrolling chats,
charts price over time with liquidity depth, tracks every event until it resolves yes/no,
and paper-trades strategies with full portfolio categorization. No manual input, no API keys
required for market data.

## Key facts (all verified — see VERIFICATION.md)

| Item | Value | Source |
|------|-------|--------|
| Demo REST base | `https://external-api.demo.kalshi.co/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) |
| Prod REST base | `https://external-api.kalshi.com/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) |
| Demo WS | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) |
| Market data auth | None required (public) | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) |
| Hierarchy | Series → Event → Market | [Glossary](https://docs.kalshi.com/getting_started/terms) |
| Gas series (example) | `KXAAAGASM` — US gas price, monthly, AAA-settled | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) |
| Golf series (example) | `KXPGAGOLFERSCORE` — Golf Round Strokes | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&limit=20) |
| Exchange status (2026-11-20) | `exchange_active: true`, `trading_active: true` | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) |

## How each requirement is met

1. **Highest-dollar live events (5 topics only).** Series discovered per topic via
   `GET /series?category=&tags=`; markets via `GET /markets?series_ticker=&status=open`;
   events ranked by `volume_fp × last_price_dollars` (documented approximation — Kalshi has no
   dollar-volume field). Topics kept separate; events grouped within each topic.
2. **≥ $0.10 swing alerting, two scrolling chats.** Each poll compares last price to previous
   poll per ticker. All swings → main chat. High-ROI subset (price $0.15–$0.85, $ volume above
   topic median, spread ≤ $0.10, |move| ≥ $0.05) → selective chat. Thresholds explicit in code.
3. **Track until resolved (yes/no).** Settled markets polled via `status=settled`; `result`
   (yes/no) + settlement time listed. Paper trades settle against `result`.
4. **Simulated trades + portfolio + strategy analysis.** Browser paper engine (auto-trades on
   high-ROI alerts) + Python backtest (`backtest.py`, `run_sim.py`) replaying snapshots.
   Results categorized by topic and strategy (trades, wins, PnL, win rate, ROI).
5. **Live interactive charts.** Canvas chart: x = time, y = contract price ($0–$1).
   Windows: 60s / 5m / 1h / 24h (seconds/minutes/hours). Backfill from candlesticks
   (`period_interval` 1/60/1440) + live poll points. Amber markers on ≥ $0.10 steps.
6. **Liquidity.** `GET /markets/{ticker}/orderbook` — YES/NO bids with contract counts per price.
7. **Jump causes.** Kalshi API has no news feed. Dashboard links each market to its official
   settlement source + API record; it never invents a cause. Auto-attribution is flagged (F2).
8. **No manual input.** Defaults work out of the box. Optional demo keys (local only) enable
   real demo execution + WebSocket streaming.
9. **GitHub Pages site.** Landing + dashboard + 5 topic pages + portfolio + methodology +
   flagged pages, all in `docs/`, deployed via Actions. Clean, simple tables throughout.

## Architecture

- **Static site** (`docs/`): vanilla JS, no build step, no dependencies. Browser fetches Kalshi
  REST directly (public endpoints). Polling default (10s); WebSocket optional with user keys.
- **Python backend** (local use): `kalshi_client.py` (REST + RSA-PSS/Ed25519 signing per official
  guide), `strategies.py`, `backtest.py`, `run_sim.py`. Never places orders except via explicit
  `place_order` with user keys.
- **Data**: `docs/data/series.json` — verified series snapshot (2026-11-20) with per-row API links.
  Live prices are never snapshotted as facts.

## Re-verification and publish status (2026-11-20, session b4e5648a)

| Item | Result | Evidence |
|---|---|---|
| Series rows in the topic tables (gas 10, elections 5, crypto 10, golf 4, culture 2) | Re-read from `GET /series/{ticker}`. Corrections: two crypto series list no settlement source; one golf settlement list was incomplete; one URL shown exactly as returned. | [series.json](docs/data/series.json) (each row links its record) · [VERIFICATION.md](VERIFICATION.md) V21–V24 |
| Culture topic | **Corrected.** Kalshi has a Culture category (2 series, no markets). The earlier "no Culture category" claim was wrong. | [Series by category: Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) |
| Market rows in the published data file (Build B: 10 rows; 9 re-read) | 6 matched. 2 golf rows had yes-ask and no-bid reversed and were corrected. 1 row (KXELONMARS-99) had drifted volume and open interest and was updated. `KXAAAGASM-26NOV30-4.50` was not re-read in this pass. | [data.js](docs/dashboard-site/assets/data.js) `REVERIFIED` · V25 |
| Fee schedule | Formula and effective date (July 7, 2026) confirmed. | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) · V26 |
| GitHub Pages | **Not live yet.** The build token cannot enable Pages (HTTP 403). One owner action is needed: Settings → Pages → Source: **GitHub Actions**. | [Flagged F8](docs/flagged.html) |

**Decisions for the owner (not blocking):** whether Culture should include Kalshi's larger Entertainment category (F15), and whether “highest dollar amount” should be volume × price or raw volume (F4).

Full list with source links: [Flagged for Review](docs/flagged.html).

## Irregularities / flags (non-blocking)

- **F1 Culture mapping (corrected 2026-11-20):** Kalshi **does** have a Culture category (2 series, no markets at capture). The Culture topic now uses it. Whether to add Kalshi’s broader Entertainment category is an owner decision (F15).
- **F2 News attribution:** no news API → settlement-source links only.
- **F3 Live execution/WS:** needs user demo keys (by design, never in repo).
- **F4 $ volume definition:** volume × price approximation; confirm intent.
- **F5 High-ROI thresholds:** unvalidated heuristic; tune via backtest.
- **F6 CORS:** verify live fetch on GitHub Pages HTTPS (Kalshi docs show browser fetch examples).
- **Sandbox note:** this build sandbox cannot reach Kalshi REST directly (egress allowlist);
  verification used official docs + live API JSON fetched through the docs proxy. The site itself
  fetches from the user's browser; whether the browser is allowed to read those responses from a
  GitHub Pages origin (CORS) could not be confirmed from the sandbox (F6, still unverified).

Full line-by-line verification: [VERIFICATION.md](VERIFICATION.md). Coordination: [COORDINATION.md](COORDINATION.md).

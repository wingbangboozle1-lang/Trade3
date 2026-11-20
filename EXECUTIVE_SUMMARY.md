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

- **F1 Culture mapping (corrected 2026-11-20):** Kalshi **does** have a Culture category (2 series, no markets at capture). The Culture topic uses it, with Entertainment queried as a clearly-labelled supplement (owner decision pending, F15/F20). Re-verified independently by a second session via a live fetch — see VERIFICATION.md V18/V28.
- **F2 News attribution:** no news API → settlement-source links only.
- **F3 Live execution/WS:** needs user demo keys (by design, never in repo).
- **F4 $ volume definition:** volume × price approximation; confirm intent.
- **F5 High-ROI thresholds:** unvalidated heuristic; tune via backtest.
- **F6 CORS:** verify live fetch on GitHub Pages HTTPS (Kalshi docs show browser fetch examples).
- **F8 Demo-UI URL pattern:** `demo.kalshi.co/markets/{ticker}` could not be verified from an
  official source; market links now use the verified API-record URL instead (flagged, needs
  human confirmation in a browser).

## Second line-by-line review (2026-11-20, session `arena/2100849c-trade3`)

A second session re-reviewed the repository line by line and re-verified every load-bearing
claim against official sources fetched live that day (docs.kalshi.com pages, the fee-schedule
PDF, and the demo REST API itself). Results: endpoints, signing, lifecycle, settlement, fee
formula (all 21 published table rows), Create Order V2 shape, and the captured market rows all
matched. Issues found were fixed in place and are logged in
[VERIFICATION.md](VERIFICATION.md): floating-point threshold comparisons that could drop
exactly-$0.10 alerts (fixed in both builds and the Python tools), NO-side entry pricing in the
simulators (now `1 − yes_bid` per the official orderbook derivation), the legacy order body in
`kalshi_client.py` (rewritten to the verified V2 shape), the Culture mapping (corrected above),
a missing `scripts/capture-snapshot.js` (implemented), and unverified demo-UI link patterns
(flagged). Full test suite rerun and green: `tests/smoke-test.js` 13/13,
`tests/site-render-test.js` 13/13, `scripts/check-links.js` 0 broken links.
- **Sandbox note:** this build sandbox cannot reach Kalshi REST directly (egress allowlist);
  verification used official docs + live API JSON fetched through the docs proxy. The site itself
  fetches from the user's browser; whether the browser is allowed to read those responses from a
  GitHub Pages origin (CORS) could not be confirmed from the sandbox (F6, still unverified).

Full line-by-line verification: [VERIFICATION.md](VERIFICATION.md). Coordination: [COORDINATION.md](COORDINATION.md).

---

## Final integration pass — session `arena/ec2f5c59-trade3` (2026-11-20T20:0xZ)

This section is additive: everything above it, including the 21-item flag ledger and the row-by-row review that
produced it, is unchanged and still true except where a line below says otherwise.

### What this pass added on top of `main`

| Addition | Why it was not already there | Where to check it |
|---|---|---|
| **Row-by-row verification harness**: `scripts/check_site.py`, `scripts/verify_series.py`, `tests/logic.test.mjs`, `tests/render.test.mjs`, `docs/verification.html`, `docs/.nojekyll`, the per-topic pages and the site's own method page | These came from session `arena/4f9f13c8-trade3`, which never merged; this branch is the first to carry them into `main` | `python3 scripts/check_site.py` · `node tests/logic.test.mjs` |
| **Catalyst panel — closes most of flag F2**: for any ≥ $0.10 alert, the executed prints for that contract in a ±10-minute window (`GET /markets/trades?ticker=…&min_ts&max_ts`, seconds) shown beside the series' own `settlement_sources` links | F2 said "dashboard links settlement sources only". It now also shows the tape. News attribution is still out of reach and stays flagged | `docs/dashboard.html` → "What may have moved this contract" |
| **`cleanTitle()`** — Kalshi ships markdown inside some titles (`Will average **gas prices** be above $5.00?`); stripped for display only, never in the data | Live gas-market records returned that exact string | `tests/logic.test.mjs` (5 assertions) |
| **Flags F22–F25** — ignored/undocumented query parameters (with the counter-observation from F16 published beside it), empty demo books + markdown titles, kalshi.com links that cannot be machine-verified (companion to F21), and this merge itself | Each was met while integrating and is not resolvable from inside the build sandbox | `docs/flagged.html` |
| **`.github/workflows/verify-live.yml`** — every 6 hours, from a runner that can reach Kalshi, `verify_series.py` re-reads all 39 rows and diffs every published field; drift is a warning + job summary, never a silent pass | The build sandbox has no shell route to `external-api.demo.kalshi.co` (F19), so continuous verification had to move to CI | Actions tab, job summary |
| **`scripts/capture-snapshot.js` with `--dry-run`, `--json`, `--env`, and an exchange-active guard**; the transform is exported pure so it is testable offline | A capture had to exist for the `snapshot` data mode to be reproducible; `main` had a first version, this refines it | `node tests/smoke-test.js` (2 new checks) |
| **39-row `series.json`**: `main`'s 31 verified rows kept verbatim, plus 8 Entertainment rows this branch had verified, each carrying `via` + `category: "Entertainment"`; every row now has **both** `source` and `source_url`, and the gate rejects them disagreeing | One build lists only Culture's own series and queries Entertainment live; the other published the Entertainment rows explicitly. Labelling beat deleting | `python3 scripts/check_site.py` |
| **Culture settlement sources left blank on purpose** (adopted from `main`'s F10) — this branch had briefly published the first source entry (ABC); that is withdrawn here | `main`'s reading is better: the record lists Google-search URLs and a personal account, which are not official publishers | `docs/data/series.json` note field; `scripts/verify_series.py` accepts `settlement_policy: official-publishers-only` as intentional |
| **Python layer: `main`'s version wins** — its `_ticks()` integer-cent comparison replaces float-epsilon threshold checks (0.42 − 0.32 = 0.0999… would silently drop an exactly-$0.10 move), and its `open_position` NO-pricing derivation is kept | Two independent fixes to the same file; theirs is strictly more correct | `strategies.py`, `backtest.py` |
| **One workflow instead of two** — this branch's `ci.yml` was deleted and its suites folded into `main`'s `pages.yml` verify job | Two workflows running overlapping checks on the same push is noise, and the deploy gate must be the one that blocks publishing | `.github/workflows/pages.yml` |

### Gates, as run at the end of this pass

`check_site.py` (pages, links, JS parse, 39-row contract, no localhost) · `check-links.js` (both builds, imports,
DOM targets) · `logic.test.mjs` · `render.test.mjs` (headless, jsdom) · `smoke-test.js` (collector, engines, routes,
capture) · `site-render-test.js` (build B pages) · `py_compile` + the offline unit block for the Python layer ·
`verify_series.py --from-cache docs/data/live-verification-2026-11-20.json` → **4/4, exit 0**.

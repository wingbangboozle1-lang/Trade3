# Executive Summary — Trade3 Kalshi Demo Dashboard

**Date:** 2026-11-20 · **last re-verified 2026-11-21** · **Environment:** Kalshi demo (mock funds) · **Site:** GitHub Pages (`docs/`)

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
   Windows: 1m / 5m / 15m / 1h / 6h / 1d / 1w (seconds/minutes/hours). Backfill from candlesticks
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
| Series rows in the topic tables (gas 10, elections 5, crypto 10, golf 4, culture 10 = 2 Culture + 8 labelled Entertainment) | Re-read from `GET /series/{ticker}`. Corrections: two crypto series list no settlement source; one golf settlement list was incomplete; one URL shown exactly as returned. | [series.json](docs/data/series.json) (each row links its record) · [VERIFICATION.md](VERIFICATION.md) V21–V24 |
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
- **F21 Demo-UI URL pattern** (ledger renumbering: this item was F8 in an earlier draft):
  `demo.kalshi.co/markets/{ticker}` could not be verified from an official source; market links
  now use the verified API-record URL instead (flagged, needs human confirmation in a browser).
- **F8 GitHub Pages:** still not enabled (403 for automation tokens, retried 2026-11-21);
  the one-time owner click is documented on the flag page and in the workflow's failure summary.

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

---

## Line-by-line audit — session `arena/6c20e938-trade3` (2026-11-21)

A third full pass re-verified the published record against the live demo API and official docs
(fresh fetches on 2026-11-21: exchange status, five series records across all five topics, the
market-data quick start, the llms.txt index, and the fee-schedule PDF). One published claim was
overstated and is now corrected in [VERIFICATION.md](VERIFICATION.md): the 2026-11-20 "all
threshold comparisons are tick-space" fix had **not** actually reached
`docs/assets/portfolio.js`'s swing-momentum strategy (float `>= 0.10` still dropped exactly-10¢
moves) and the dashboard used a float-epsilon test; both now share `ticks`/`movedTicks`/`isSwing`
helpers with regression tests. Also fixed: duplicate verification IDs (V21/V22 collided),
`requirements/REQUIREMENTS.md` pointing at files that do not exist in this tree, and the
missing `/suggestions.html` page (now built and linked in every nav). Full detail:
[VERIFICATION.md](VERIFICATION.md) "session arena/6c20e938-trade3" section.

---

## Re-verification pass — session `arena/b47b1c48-trade3` (2026-11-21)

Re-read the key published rows against the live demo API again and re-ran every gate. One documentation
irregularity was found and corrected: the `series.json` Culture settlement notes (and flag F10) described
the `KXXBANNEDGROK` / `KXXBANNEDMURRAYHILLGUY1` settlement list as only non-official entries and claimed
ABC had been "withdrawn" — both false. The live records carry **23 mixed settlement sources** (17 official
publishers incl. Barchart + a few Google-search/personal entries), and ABC is present. The notes now state this accurately;
the decision to leave settlement blank under the official-publishers-only policy is unchanged.

| Item | Result | Evidence |
|---|---|---|
| Exchange status | `exchange_active: true`, `trading_active: true`, shards 0–3 | [GET /exchange/status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) |
| Gas / Golf / Crypto rows | `KXAAAGASM`, `KXPGAGOLFERSCORE`, `KXETHD` all match `series.json` | [KXAAAGASM](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) · [KXPGAGOLFERSCORE](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGAGOLFERSCORE) · [KXETHD](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHD) |
| Culture category | 2 series, `category: Culture` — confirms the earlier correction | [Series by category: Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) |
| Culture markets | empty — confirms F9 | [Markets for KXXBANNEDGROK](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDGROK&status=open) |
| Local gates | `npm test`, `check_site.py`, `check-links.js`, `py_compile`, JSON parse — all pass | See [VERIFICATION.md](VERIFICATION.md) |
| GitHub Pages | **Still not enabled** (404; enablement returns 403 to automation). Owner action required — see F8 | [docs/flagged.html](docs/flagged.html) |

---


---

---

## Re-verification + deploy-hardening pass — session `arena/77ec3a0e-trade3` (2026-11-21)

Additive record. Everything above remains true except where noted.

### Live re-verification against the official demo API (fetched 2026-11-21)

| Claim re-checked | Official source (live fetch) | Result |
|---|---|---|
| Exchange active / trading active | [GET /exchange/status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | `exchange_active: true`, `trading_active: true`, shards 0–3 — matches published rows |
| Gas anchor series `KXAAAGASM` | [Series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | title "US gas price", category `Economics`, tags `Oil & Gas` / `Oil and energy`, scope `Gasoline`, `fee_multiplier: 1`, `fee_type: quadratic`, `frequency: monthly`, settlement `AAA — https://gasprices.aaa.com/` — matches `docs/data/series.json` |
| Crypto anchor series `KXETHD` | [Series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHD) | category `Crypto`, `frequency: hourly`, settlement `CF Benchmarks — https://www.cfbenchmarks.com/data/indices/ETHUSD_RTI` — matches |
| Golf anchor series `KXPGAGOLFERSCORE` | [Series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGAGOLFERSCORE) | category `Sports`, tag `Golf`, scope `Golfer Score`, settlement list (NBC Sports, Fox Sports, Governing League/pgatour.com, AP, Golf Channel) — matches |
| Culture category exists (2 series) | [Series by category: Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) | `KXXBANNEDGROK`, `KXXBANNEDMURRAYHILLGUY1` — matches published rows |
| `Gas` is not a category | [Series by category: Gas](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Gas) | `{"series":null}` — the Economics + tag mapping stands |

All 39 published rows carry a per-row official API `source_url`; the scheduled CI job
`verify-live.yml` re-reads every row from a runner with Kalshi egress every 6 hours.

### GitHub Pages blocker — root cause confirmed from an official source

`GET /repos/…/pages` → 404 and `POST /repos/…/pages` → 403 "Resource not accessible by integration"
were re-tested on 2026-11-21 from both the sandbox token and the Actions workflow token. The reason is
now cited from the official [`actions/configure-pages` action.yml](https://github.com/actions/configure-pages/blob/main/action.yml):
the `enablement` option — the only automated route to create a Pages site — *"requires a token other
than `GITHUB_TOKEN` to be provided. In the context of a Personal Access Token, the `repo` scope or
Pages write permission is required. In the context of a GitHub App, the `administration:write` and
`pages:write` permissions are required."* No token in this environment has those permissions, so the
site creation needs the one owner click (Settings → Pages → Source: **GitHub Actions** → Save).

The deploy workflow (`pages.yml`) was hardened in a merge-safe combination with the parallel
fix from sessions 8214edf2/8373696a (PRs #18/#19): `actions/configure-pages` with `enablement: true`
gets its chance first (per the official `api-client.js`, it fetches the site and only calls
`createPagesSite` — `POST /pages`, `build_type: workflow` — on a miss), and when that cannot create
the site the readiness gate **repeats the `POST /pages` attempt itself** before surfacing the
owner-action error, so the deploy self-heals if the repository token ever gains the required
permission. Flag F8 on the [Flagged for Review](docs/flagged.html) page carries this evidence and
all three source links.

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
[demo UI](https://demo.kalshi.co/) under Account & security → API Keys. This project signs requests locally; the
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
npm test                        # logic + engine/routes + site pages (the three suites that must pass to publish)
npm run test:all                # the above plus the headless render harness (needs jsdom, see below)
node tests/smoke-test.js        # 15 checks: engine, routing, fees, settlement, all HTTP routes, all data modes, snapshot capture
node tests/site-render-test.js  # 13 checks: every page script renders real content, no "undefined"
node tests/logic.test.mjs       # order-book maths, ROI screen, candle intervals, titles, topic mapping
node tests/render.test.mjs      # boots docs/dashboard.html in jsdom (npm install --no-save jsdom@25)
node scripts/check-links.js     # 0 broken local links, anchors, imports or DOM targets — both builds
python3 scripts/check_site.py   # pages, links, JS parse, the 39-row data contract, no localhost refs
python3 scripts/verify_series.py# re-reads every published row from the live demo API and diffs it
```

Two workflows run these without anyone asking: **`pages.yml`** gates and then publishes `docs/`, and
**`verify-live.yml`** re-reads all 39 published rows from the demo API every 6 hours and turns any drift into a
warning plus a job summary. [Flagged F8](docs/flagged.html) is the one owner click Pages still needs.

## Verification notes

The API facts this project depends on were read from the official documentation before any code was written, then
confirmed against the live demo API. The findings that changed the design:

- **Gas and Golf are not top-level Kalshi categories.** In the verified demo responses, gas series use `Economics` with the `Oil & Gas` tag; golf series use `Sports` with the `Golf` tag.
- **Culture is a first-class category.** The official demo API returned two series from `GET /series?category=Culture` (independently re-confirmed by a second session; the topic page also lists Entertainment as a labelled supplement, flags F15/F20); an earlier build incorrectly mapped it to Entertainment. The checked `KXXBANNEDGROK` series had no open markets at verification time. See the correction in [Flagged for Review](docs/flagged.html).
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

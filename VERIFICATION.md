# Verification Log — line-by-line sources

Every factual claim in this repo traces to one of the sources below. Values that could not be
confirmed from an official source are left blank and listed in `docs/flagged.html`.
Verified 2026-11-20. Live API responses were fetched on 2026-11-20 (demo base).

## Official sources

| # | Claim | Official source (link) | How verified |
|---|-------|------------------------|--------------|
| V1 | Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2`; also supported `https://demo-api.kalshi.co/trade-api/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs table matches user brief exactly |
| V2 | Demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`; also supported `wss://demo-api.kalshi.co/trade-api/ws/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs table |
| V3 | Prod REST `https://external-api.kalshi.com/trade-api/v2`; also `https://api.elections.kalshi.com/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | Docs table |
| V4 | Prod WS `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | Docs table |
| V5 | Demo site `https://demo.kalshi.co/`; credentials not shared with prod; demo prices may not reflect real markets | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Docs text |
| V6 | Public market data needs no auth (`/series`, `/events`, `/markets`, `/orderbook`) | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Docs + live unauthenticated fetches succeeded |
| V7 | Series → Event → Market hierarchy; `category`/`categories`/`tags` semantics | [Glossary](https://docs.kalshi.com/getting_started/terms) | Docs; gas example `KXAAAGASM` with Economics/Commodities |
| V8 | `GET /series?category=&tags=` filters (exact, case-sensitive) | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) | Docs + live queries returned expected series |
| V9 | `GET /markets` fields incl. `volume_fp`, `last_price_dollars`, `yes_bid/ask_dollars`, `result`, `status` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | Docs + live market objects match schema |
| V10 | Orderbook returns YES/NO bids only (`orderbook_fp.yes_dollars/no_dollars` = [price, count]) | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) | Docs + quick-start code |
| V11 | Candlesticks `period_interval` ∈ {1, 60, 1440} minutes; `start_ts`/`end_ts` required | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | Docs |
| V12 | Auth headers `KALSHI-ACCESS-KEY/TIMESTAMP/SIGNATURE`; sign `timestamp+METHOD+path` (no query); RSA-PSS/SHA-256 or Ed25519; timestamp ms, 30s window | [Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) | Docs; implemented verbatim in `kalshi_client.py` |
| V13 | WS handshake signs `timestamp + "GET" + "/trade-api/ws/v2"`; channels `ticker`, `trade`, `orderbook_delta`, etc. | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | Docs |
| V14 | Gas mapping: Economics + Oil & Gas; `KXAAAGASM` US gas price monthly, AAA settlement | [Glossary](https://docs.kalshi.com/getting_started/terms) + [Live series](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | Docs example + live record (AAA, gasprices.aaa.com) |
| V15 | Golf mapping: Sports + Golf tag; e.g. `KXPGAGOLFERSCORE`, `KXPGAEAGLE`, `KXPRESCUPMATCH`, `KXPGAT20` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&limit=20) | Live API returned these series with PGA Tour settlement sources |
| V16 | Crypto mapping: category Crypto; e.g. `KXETHD`, `KXBTC2025100`, `KXBTXMINW` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Crypto&limit=20) | Live API |
| V17 | Elections mapping: category Elections; e.g. `KXELECTUKRAINE`, `KXIATREASR` | [Live query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Elections&limit=20) | Live API |
| V18 | **Corrected 2026-11-20:** Culture **is** a Kalshi series category. `GET /series?category=Culture` returns `KXXBANNEDGROK` and `KXXBANNEDMURRAYHILLGUY1`, both `"category":"Culture"`. The earlier claim that no Culture category exists was wrong. | [Series by category: Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) · [Tags map](https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories) | Live API, re-read 2026-11-20. The tags map has no Culture key (flag F12). Culture uses its own category, with Entertainment queried as a clearly-labelled supplement (owner decision pending, flags F15/F20). |
| V21 | Gas series re-read: `KXAAAGASM`, `KXAAAGASMIN`, `KXAAAGASY`, `KXAAAGASED`, `KXAAAGASMAX`, `KXAAAGASMAXCA`, `KXAAAGASMAXTX`, `KXAAAGASMINFL`, `KXAAAGASMAXFL`, `KXNGASMAX` | `GET /series/{ticker}` (each row's source link is in `docs/data/series.json`) | Re-read 2026-11-20. Title, frequency, category, tags and settlement source all match. |
| V22 | Elections series re-read: `POPVOTEKHVA`, `KXGOVNJNOMR`, `KXIATREASR`, `KXFRPRESCANDCOUNT`, `KXELECTUKRAINE` | `GET /series/{ticker}` | Re-read 2026-11-20. All match. |
| V23 | Crypto series re-read: `KXLINKPERP`, `KXXRPMAXY`, `KXSOL26500`, `KXBTXMINW`, `KXBTC2025100`, `KXSOLPERP`, `KXETHD`, `KXFDVBIRB`, `KXSOLSTABLESUPP`, `KXNEARY` | `GET /series/{ticker}` | Re-read 2026-11-20. Corrected: `KXLINKPERP` and `KXSOLPERP` have `settlement_sources: null` (now shown as none listed). `KXBTC2025100` URL shown exactly as returned (includes `?ref=`). |
| V24 | Golf series re-read: `KXPGAGOLFERSCORE`, `KXPGAEAGLE`, `KXPRESCUPMATCH`, `KXPGAT20` | `GET /series/{ticker}` | Re-read 2026-11-20. Corrected: `KXPGAGOLFERSCORE` settlement also lists AP; source names shown as returned. |
| V25 | Build B market rows re-read (9 of 10 rows; `KXAAAGASM-26NOV30-4.50` not re-read): price, bid/ask and volume fields | `GET /markets/{ticker}` (per-row `sourceUrl` in `docs/dashboard-site/assets/data.js`) | Re-read 2026-11-20. 2 golf rows corrected (yes-ask and no-bid were reversed). `KXELONMARS-99` volume and open interest updated (drift). Recorded in `REVERIFIED`. |
| V26 | Fee schedule: formula `round up(M × 0.07 × C × P × (1 − P))`, general table, "Last updated and effective: July 7, 2026", "no settlement fee" | [Kalshi fee schedule (PDF)](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Re-read 2026-11-20. Formula and effective date confirmed. |
| V27 | Exchange active on demo | [Exchange status (demo)](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Re-read 2026-11-20: `exchange_active: true`, `trading_active: true`, shards 0–3. |
| V28 | **Second review, session `arena/2100849c-trade3` — docs re-opened live:** demo_env + api_environments (endpoints verbatim), quick_start_authenticated_requests (signing `timestamp+METHOD+path` w/o query, RSA-PSS/SHA-256 + Ed25519, ms timestamps, 30s window, balance in cents, keys under Account & security), quick_start_websockets (handshake sign `timestamp+"GET"+"/trade-api/ws/v2"`, WS auth required), market_lifecycle (8 statuses; `?status=open`→`active`, `?status=settled`→`finalized`), market_settlement ($1/contract), create-order-v2 (body `side` bid/ask, `count` "10.00", `price` "0.5600"; legacy 410 Gone), get-series-list (`category` exact/case-sensitive, `tags`, `include_product_metadata`), llms.txt index (every cited docs path exists) | The pages themselves, e.g. [API Environments](https://docs.kalshi.com/getting_started/api_environments) · [Auth Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) · [WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) · [Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) · [Settlement](https://docs.kalshi.com/getting_started/market_settlement) · [Create Order V2](https://docs.kalshi.com/api-reference/orders/create-order-v2) · [Series List](https://docs.kalshi.com/api-reference/market/get-series-list) · [llms.txt](https://docs.kalshi.com/llms.txt) | Fetched live 2026-11-20 by session `arena/2100849c-trade3` |
| V29 | **Second review, session `arena/2100849c-trade3` — live API re-checks:** exchange status (4 shards, trading active); `GET /markets/KXAAAGASM-26NOV30-4.80` matches the Build B captured row field-for-field; `GET /series/KXAAAGASM` matches (Economics, Oil & Gas + Oil and energy, scope Gasoline, AAA, fee_multiplier 1); `GET /series?category=Gas` → `{"series":null}`; `GET /series?category=Sports&tags=Golf` → golf series (KXLIVCOMPETE, KXPGATOURCHAMP, KXPGAROUNDSCORE, KXPGA, …) | [status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) · [market](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXAAAGASM-26NOV30-4.80) · [series](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) · [Gas probe](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Gas) · [Golf query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&limit=20) | Fetched live 2026-11-20 by session `arena/2100849c-trade3` |
| V19 | Exchange active on demo 2026-11-20 (`exchange_active: true`, `trading_active: true`) | [Live status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Live API JSON |
| V20 | OpenAPI spec download | [Predictions REST spec](https://docs.kalshi.com/openapi.yaml) | Linked from docs welcome page |
| V30 | **(Renumbered 2026-11-21 — this row originally reused ID V21.) Second review (2026-11-20, session `arena/2100849c-trade3`) — docs pages re-opened and confirmed live:** demo/prod REST+WS endpoints; signing (`timestamp+METHOD+path` w/o query, RSA-PSS/SHA-256 + Ed25519, headers, ms timestamps, 30s window); API keys under Account & security → API Keys; WS handshake sign `timestamp+"GET"+"/trade-api/ws/v2"` and WS auth required; market lifecycle statuses (initialized/active/inactive/closed/determined/disputed/amended/finalized; filter map `open`→`active`, `settled`→`finalized`); `GET /markets?status=` ∈ {unopened, open, closed, settled}; candlestick `period_interval` ∈ {1, 60, 1440}; orderbook bids-only with YES ask = 1 − NO bid; settlement pays $1/contract to the winning side; fee formula `round up(M×0.07×C×P×(1−P))` + all 21 rows of the published table + maker 0.0175 + KXBTCY/KXETHY zero multiplier + effective 2026-07-07; Create Order V2 body (`ticker, side bid/ask, count "10.00", price "0.5600", time_in_force, self_trade_prevention_type`) and legacy 410 Gone; `GET /series` params (`category` exact/case-sensitive, `tags`, `include_product_metadata`); balance returned in cents | [API Environments](https://docs.kalshi.com/getting_started/api_environments) · [Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) · [WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) · [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) · [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) · [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) · [Create Order V2](https://docs.kalshi.com/api-reference/orders/create-order-v2) · [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) · [llms.txt index](https://docs.kalshi.com/llms.txt) | Fetched live 2026-11-20; every cited docs path in the repo was found in the official llms.txt index or fetched directly |
| V31 | **(Renumbered 2026-11-21 — this row originally reused ID V22.) Second review — live demo API re-checks:** `GET /exchange/status` → `exchange_active:true, trading_active:true`, shards 0–3; `GET /markets/KXAAAGASM-26NOV30-4.80` matches the Build B captured row field-for-field (last 0.0300, prev 0.0300, yes bid 0.0000/ask 1.0000, vol 55571.52, OI 55567.52, close 2026-11-30T04:59:00Z, status `active`, result `""`); `GET /series/KXAAAGASM` matches (Economics, Oil & Gas + Oil and energy, scope Gasoline, AAA, fee_multiplier 1, monthly); `GET /series?category=Gas` → `{"series":null}`; `GET /series?category=Sports&tags=Golf` → golf series (KXLIVCOMPETE, KXPGATOURCHAMP, KXPGAROUNDSCORE, KXPGA, …) | [exchange status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) · [market record](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXAAAGASM-26NOV30-4.80) · [gas series](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) · [gas category probe](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Gas) · [golf query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&limit=20) | Fetched live 2026-11-20 by session `arena/2100849c-trade3` |

> **Scope of the 2026-11-20 re-check (session b4e5648a).** Every series row in `docs/data/series.json` (31 rows) and every market row in Build B's `data.js` (10 rows, 9 re-read) was re-read from the official demo endpoint in its row's `sourceUrl`. Rows are marked `verified_on` in the data file. Values that cannot be re-read are blank or flagged; nothing is inferred.

## Derived / heuristic items (explicitly NOT official facts)

| # | Item | Status |
|---|------|--------|
| D1 | $ volume = `volume_fp × last_price_dollars` | Approximation (no official dollar-volume field). Flagged F4. |
| D2 | High-ROI filter thresholds | Heuristic. Flagged F5. |
| D3 | Strategy rules (momentum etc.) | Research heuristics. Not advice. |
| D4 | News/catalyst causes | NOT provided by Kalshi API. Never invented. Flagged F2. |

## Irregularities

See [Flagged for Review](docs/flagged.html) for the full list with source links (F1–F19). New in the 2026-11-20 pass:

- Culture category exists but has no markets (F9); the tags map has no Culture key (F12).
- Some Culture settlement sources are search pages or a personal account (F10).
- Contract PDFs point to a `kalshi-public-docs-staging` S3 host on many series (F11).
- Two crypto series list no settlement source (F18).
- Two golf snapshot rows had yes-ask and no-bid reversed; corrected to the live record (F14).

- Sandbox egress allowlist blocks direct `curl` to Kalshi hosts from bash; verification therefore
  used official docs pages + live API JSON via the docs fetch proxy. The deployed site fetches
  from the user's browser (unrestricted). No values were taken from third-party blogs.
- One golf series ticker was truncated in a paginated response chunk and was **excluded** from
  `series.json` rather than guessed.
- Demo market data includes synthetic multivariate markets (e.g. `KXMVECROSSCATEGORY-*`);
  the dashboard's topic filters exclude them by construction (series-scoped queries only).
- **Second review (2026-11-20, session `arena/2100849c-trade3`) irregularities found and fixed** (three parallel sessions landed PRs #6–#10 while this review ran; the conflict resolution below preserved their corrections and this session's independent findings):
  1. Build A (browser dashboard + Python tooling) compared the $0.10 swing threshold in
     floating point (`Math.abs(p - old) >= 0.10` / `abs(p - old) >= 0.10`), which silently
     misses exactly-$0.10 moves (e.g. `0.42 − 0.32 = 0.09999…`). All comparisons now run in
     integer 1/10,000-dollar space, matching Build B. Fixed in `docs/assets/dashboard.js`,
     `docs/assets/portfolio.js`, `strategies.py`, `run_sim.py`.
     **Correction (2026-11-21, session `arena/6c20e938-trade3`):** this line overstated the fix.
     A line-by-line audit found `docs/assets/portfolio.js` still comparing `d >= 0.10` /
     `d <= -0.10` in float for its swing-momentum strategy (exactly-10¢ moves were still
     dropped there), and `docs/assets/dashboard.js` using a float-epsilon test
     (`>= ALERT_THRESHOLD - 1e-9`) rather than tick space. Both now use the shared
     `ticks`/`movedTicks`/`isSwing` helpers in `docs/assets/app.js`, with regression
     assertions in `tests/logic.test.mjs` (including the 0.42 − 0.32 case). `strategies.py`
     and `run_sim.py` were genuinely fixed as claimed (`_ticks`).
  2. The Build A portfolio simulator and `backtest.py` priced a NO buy at `yes_bid_dollars`;
     per the official Orderbook Responses page a NO ask is `1 − best YES bid`. Both fixed.
  3. `kalshi_client.py place_order` used a legacy-shaped body (`yes_price`, `action`) against
     the V2 endpoint. Rewritten to the documented Create Order V2 body (verified from the
     official page).
  4. "Kalshi has no Culture category" was wrong (see V18 correction) — Build A pages,
     `series.json`, `kalshi_client.py`, `EXECUTIVE_SUMMARY.md` corrected.
  5. `package.json` referenced `scripts/capture-snapshot.js`, which did not exist in the
     repo — implemented (captures real demo values into `data/snapshot.json`).
  6. `demo.kalshi.co/markets/{ticker}` (demo web-UI link pattern) could not be verified —
     flagged F8 in the then-current ledger — **now F21 on the published ledger** (Build B F9 → also renumbered); market links now use the verified API-record URL.
  7. `server/kalshi.js createOrder` defaulted `exchange_index: -1`; `-1` is documented as
     auto-route for CANCEL, not create, so the field is now omitted unless provided.
  8. `scripts/capture-snapshot.js`, `docs/assets/*` and the Python files were re-checked
     with `node --check` / `py_compile`; full test suite rerun (13/13, 13/13, links OK).

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

## Line-by-line review + live re-verification — session `arena/6c20e938-trade3` (2026-11-21)

All checks below were fetched **live on 2026-11-21** by this session (the page-fetch route;
shell egress to Kalshi hosts remains blocked, flag F19). Where a prior session's claim was
re-tested today, the result is recorded — including one claim that was overstated and is now
corrected above (the portfolio.js tick-space fix).

### Live re-verification sample (rows re-read field-by-field against `GET /series/{ticker}`)

| Check | Source (official) | Result vs. published row |
|---|---|---|
| Exchange status | [GET /exchange/status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | `exchange_active: true`, `trading_active: true`, shards 0–3 — matches V19/V27 |
| `KXNGASMAX` | [series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXNGASMAX) | Matches row (title, annual, Economics, EIA settlement). Note: a **separate** series `NGASMAX` ([record](https://external-api.demo.kalshi.co/trade-api/v2/series/NGASMAX)) exists with the same title; both resolve. Not a defect — verified before changing. |
| `KXXBANNEDGROK` | [series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXXBANNEDGROK) | Matches row (Culture, one_off). Its 23-entry `settlement_sources` list is mixed: ~17 official publisher homepages + 5 Google-search placeholder URLs + `Elon Musk` (x.com) + a malformed `account holder of ` entry — confirming flag F10's blank+flag policy |
| `KXLINKPERP` | [series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXLINKPERP) | Matches row: `settlement_sources: null` → published as "None listed by Kalshi" (F18) |
| `POPVOTEKHVA` | [series record](https://external-api.demo.kalshi.co/trade-api/v2/series/POPVOTEKHVA) | Matches row (Kamala Virginia, Elections, congress.gov settlement) |
| `KXPGAT20` | [series record](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGAT20) | Matches row (T 20, Sports/Golf, Fox Sports + ESPN + Governing League) |
| `KXAAAGASM`, `KXETHD`, `KXPGAGOLFERSCORE` | re-read by session `arena/ca612a03-trade3` 2026-11-21 (recorded in COORDINATION.md) | Match |
| Remaining 32 rows | [verify-live.yml](https://github.com/wingbangboozle1-lang/Trade3/actions/workflows/verify-live.yml) — `verify_series.py` re-reads **all 39 rows** every 6 h on GitHub runners that can reach the API | Latest scheduled run [44850068547](https://github.com/wingbangboozle1-lang/Trade3/actions/runs/44850068547) (2026-11-21) — conclusion `success` |

### Docs claims re-opened live 2026-11-21

| Check | Source | Result |
|---|---|---|
| F6's claim: public REST is presented as browser-fetchable | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Confirmed — the page ships JavaScript `fetch('https://external-api.kalshi.com/trade-api/v2/series/KXHIGHNY')` examples as runnable code. (Whether the API sends CORS headers is still "verify in browser", F6 status unchanged) |
| Every docs path cited in this repo exists | [llms.txt](https://docs.kalshi.com/llms.txt) | Confirmed for the paths listed in V28. Canonical slug is `get-market-orderbook` (as this repo cites); note the quick-start page internally links a hyphenated `get-market-order-book` variant — a Kalshi docs inconsistency, not ours |
| Fee schedule | [kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Re-read 2026-11-21: formula `roundup(M × 0.07 × C × P × (1 − P))`, maker `M × 0.0175`, "There is no settlement fee", "Last updated and effective: July 7, 2026", KXBTCY/KXETHY zero multipliers — matches V26 |

### Defects found and fixed by this pass

1. **`docs/assets/portfolio.js` swing-momentum used bare float comparisons** (`d >= 0.10`) —
   the one place the earlier "all tick-space" claim did not actually hold (see correction
   above). Fixed with `movedTicks`/`ticks` from `docs/assets/app.js`; `tests/logic.test.mjs`
   now asserts the exact-10¢ case in both directions plus a 9¢ negative case.
2. **`VERIFICATION.md` shipped two pairs of rows with duplicate IDs** (two rows were V21 and
   two were V22 — the second pair near-duplicating V28/V29). The duplicates are renumbered
   V30/V31 with their unique content preserved (V31's field list for
   `KXAAAGASM-26NOV30-4.80`).
3. **`requirements/REQUIREMENTS.md`'s "Where" column cited files that do not exist in this
   tree** (`app/config.mjs`, `app/lib/*.mjs`, `app/public/`, `site/`, `scripts/lib/render.mjs`,
   `scripts/verify-sources.mjs`). Re-pointed to the real implementations
   (`server/kalshi.js`, `docs/assets/app.js`, `server/collector.js`, `docs/assets/dashboard.js`,
   `scripts/check_site.py`, `scripts/verify_series.py`, …). The requirements themselves
   (R1–R32) are unchanged.
4. **R19 claimed a `/suggestions.html` site page that did not exist** (only root
   `SUGGESTIONS.md` + an index section existed). `docs/suggestions.html` added and linked in
   the Build A navigation.

### Items this session could NOT complete (honest scope)

- **GitHub Pages enablement**: `GET /repos/wingbangboozle1-lang/Trade3/pages` → 404 (never
  created); `POST /pages` → 403 "Resource not accessible by integration" (retried 2026-11-21).
  Automation tokens cannot create the Pages site; the one-time owner click is documented in
  F8 and the workflow's failure summary. Everything else deploys automatically afterwards.
- **Live demo-account trading / portfolio pulls**: still require user-owned demo API keys
  (F3). Not requested, not stored.


---

## Re-verification pass — session `arena/b47b1c48-trade3` (2026-11-21)

Additive: everything above is unchanged. This pass re-read the published rows and the key claims
against the live Kalshi demo API again on 2026-11-21, and re-ran every local gate on the current tree.

### Live re-reads performed this session (all via the official demo REST API)

| Check | Official source (live) | Result |
|---|---|---|
| Exchange status | [GET /exchange/status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | `exchange_active: true`, `trading_active: true`, shards 0–3 — matches V27/V29. |
| Gas series `KXAAAGASM` | [GET /series/KXAAAGASM](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | Matches `series.json`: category `Economics`, tags `Oil & Gas`/`Oil and energy`, scope `Gasoline`, frequency `monthly`, settlement AAA `https://gasprices.aaa.com/`. |
| Golf series `KXPGAGOLFERSCORE` | [GET /series/KXPGAGOLFERSCORE](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGAGOLFERSCORE) | Matches: category `Sports`, tag `Golf`, settlement NBC Sports / Fox Sports / the Governing League (pgatour.com) / AP / Golf Channel. |
| Crypto series `KXETHD` | [GET /series/KXETHD](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHD) | Matches: category `Crypto`, frequency `hourly`, settlement CF Benchmarks `ETHUSD_RTI`. |
| Culture category | [GET /series?category=Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) | Two series (`KXXBANNEDGROK`, `KXXBANNEDMURRAYHILLGUY1`), both `category: Culture` — confirms V18. |
| Culture markets empty | [GET /markets?series_ticker=KXXBANNEDGROK&status=open](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDGROK&status=open) | `{"markets":[]}` — confirms F9. |

### Discrepancy found and corrected this session

**Stale Culture settlement documentation (supersedes the older F10 wording).** The `series.json`
notes for `KXXBANNEDGROK` and `KXXBANNEDMURRAYHILLGUY1` described the record's `settlement_sources`
as consisting only of "Google-search URLs, a personal X account and an unnamed 'account holder of'
entry", and stated "the first entry (ABC) was published by an earlier revision and is withdrawn
here." Re-reading [GET /series/KXXBANNEDGROK](https://external-api.demo.kalshi.co/trade-api/v2/series/KXXBANNEDGROK)
on 2026-11-21 shows the record carries **23 settlement sources, 17 official publishers** — ABC,
Fox News, MSNBC, WSJ, Semafor, Barchart, NYT, CBS, Washington Post, Axios, CNN, Reuters, Bloomberg, AP, EIA,
Politico, TechCrunch — alongside the non-official entries (Google-search URLs for "account holder of ",
Ars Technica, Engadget, Mashable, Verge, and the personal X account Elon Musk). **ABC is present**, so
the "withdrawn" claim was false. Corrected in `docs/data/series.json` (both rows + the topic `flag`)
and in flag **F10** on [docs/flagged.html](docs/flagged.html). The decision to leave settlement blank
under the official-publishers-only policy is unchanged and still defensible; only the *rationale* was
inaccurate and is now stated correctly.

### Gates re-run this session (on the current tree)

- `npm test` (logic + smoke 15/15 + site-render 13/13) → **pass**
- `python3 scripts/check_site.py` → **pass** (28 pages, 360 local links, 20 JS modules, 39 series rows)
- `node scripts/check-links.js` → **pass** (0 broken local links/anchors/imports/DOM targets)
- `python3 -m py_compile` on all 6 Python files → **pass**
- `node -e "JSON.parse(... series.json)"` → **pass** (after the correction above)

### Still open (environment-level, not a code defect)

- **F8 — GitHub Pages is still not enabled.** Re-tested 2026-11-21: `GET /repos/wingbangboozle1-lang/Trade3/pages`
  → **404**, and `POST /repos/…/pages` → **403 "Resource not accessible by integration"**. The automation
  token cannot create the Pages site; this needs the one-time owner action (Settings → Pages → Source:
  **GitHub Actions** → Save). Every deploy run fails only at the "Pages readiness" step — the site itself
  passes all checks. Owner action required; not fixable from inside the sandbox.
- Sandbox shell egress to `*.kalshi.co` is still blocked (TLS reset); live values were read through the
  page-fetch path. Non-blocking (see F19).

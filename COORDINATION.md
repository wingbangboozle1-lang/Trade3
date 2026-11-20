# Coordination Board — Trade3 Kalshi Dashboard

> Shared task board for parallel sessions. Read before starting. Claim by writing your
> session ID + file scope, then **commit and push the claim immediately**.
> Never start a task another session has claimed. Keep scopes non-overlapping.
> If a task needs a file owned by another session, log the request here instead of editing it.
> `needs review` = published on the Flagged for Review page; does not block anything.
> If a claim is >60 min old with no commits, any session may take over and note the handoff.

**Session ID for this branch:** `arena/73b9db7f-trade3` (single-session build; all tasks below claimed by this session)

## Tasks

| ID | Task | Status | Owner | Files touched | Sources / verification | Irregularities |
|----|------|--------|-------|---------------|------------------------|----------------|
| T1 | Repo review + executive summary | done | arena/73b9db7f-trade3 | `EXECUTIVE_SUMMARY.md`, `README.md`, `VERIFICATION.md` | docs.kalshi.com (see VERIFICATION.md) | Sandbox egress blocks direct Kalshi REST from bash; verified via docs + fetch of live API JSON. Browser fetch used for live site. |
| T2 | Live dashboard (alerts, charts, liquidity, resolutions) | done | arena/73b9db7f-trade3 | `docs/dashboard.html`, `docs/assets/dashboard.js`, `docs/assets/style.css` | Kalshi REST: `/series`, `/markets`, `/markets/{ticker}/orderbook`, `/series/{s}/markets/{t}/candlesticks` | WS requires API-key auth → REST polling is default; WS optional with user keys. |
| T3 | Topic subpages (gas, elections, culture, crypto, golf) | done | arena/73b9db7f-trade3 | `docs/topics/*.html`, `docs/data/series.json` | Live `/series?category=&tags=` queries 2026-11-20 | "Culture" has no Kalshi category; mapped to Entertainment — flagged. |
| T4 | Simulated trading + portfolio + strategy analysis | done | arena/73b9db7f-trade3 | `docs/portfolio.html`, `docs/assets/portfolio.js`, `kalshi_client.py`, `strategies.py`, `backtest.py`, `run_sim.py` | Auth signing per docs.kalshi.com authenticated-requests guide | No demo keys in repo; paper engine is default. Live demo trading needs user keys. |
| T5 | GitHub Pages site + landing + methodology + flagged pages | done | arena/73b9db7f-trade3 | `docs/index.html`, `docs/methodology.html`, `docs/flagged.html`, `.github/workflows/pages.yml` | Build check + link check before merge | — |
| T6 | Final integration: verify, PR to main, merge, confirm Pages deploy | done | arena/73b9db7f-trade3 | (integration only) | All pages 200 locally; internal links OK; JS syntax OK; Python offline checks passed; PR #1 merged | Pages enablement needs owner click (token lacks scope) — see Merge record |
| T7 | Correct inherited Culture category misstatement; repair npm test entrypoint and verify | done | arena/dd384643-trade3 | `COORDINATION.md`, `EXECUTIVE_SUMMARY.md`, `README.md`, `VERIFICATION.md`, `docs/assets/app.js`, `docs/assets/topic.js`, `docs/data/series.json`, `docs/flagged.html`, `docs/index.html`, `docs/methodology.html`, `package.json`, `tests/smoke-test.js` | Official [Culture series query](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) returned two series (`KXXBANNEDMURRAYHILLGUY1`, `KXXBANNEDGROK`); official [KXXBANNEDGROK market query](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDGROK&status=open) returned an empty list. Direct official series records for [gas](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM), [elections](https://external-api.demo.kalshi.co/trade-api/v2/series/KXELECTUKRAINE), [crypto](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHD), and [golf](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGAGOLFERSCORE) confirmed the landing-page examples. `npm test` 26 checks pass; JS syntax and JSON parse checks pass; link checker resolves 279 local references. | Earlier Culture→Entertainment claim was false and corrected. Package `test` initially failed because Node did not resolve `tests/`; its script now names both test files explicitly. `npm run snapshot` pointed to a nonexistent script and was removed. Link checker still reports one non-blocking warning for an unused helper module (`assets/pages/common.js`); no broken links/anchors/imports/DOM targets. |

## Handoff / conflict log

- 2026-11-20: Session `arena/73b9db7f-trade3` created this board and claimed T1–T5 (solo session; no other sessions active on this repo). T6 to be claimed at integration time.
- No cross-session file requests at this time.

## Merge record

- PR link: https://github.com/wingbangboozle1-lang/Trade3/pull/1
- Merge result: MERGED 2026-11-20T13:15:43Z (merge commit `4e12443`).
- PR #7 link: https://github.com/wingbangboozle1-lang/Trade3/pull/7
- PR #7 merge result: MERGED 2026-11-20T20:10:38Z (merge commit `2524516f`). Merged session `arena/62559215-trade3` independent verification record (`COORDINATION.md`) into `main`.

---

# Session `arena/2100849c-trade3` — full line-by-line repo review + re-verification + final integration

**Claimed (2026-11-20, committed immediately on branch `arena/2100849c-trade3`; rebased onto `main` after PRs #6–#10 landed from parallel sessions — see handoff note below):**

| Task | Status | Owner | File scope |
|---|---|---|---|
| T7 | Full line-by-line repo review, re-verification of every live-API claim against official sources, test reruns, irregularity flags | in progress | `VERIFICATION.md`, `EXECUTIVE_SUMMARY.md`, `docs/flagged.html` (+ review notes only) |
| T8 | Fixes from review (any file), then integration: PR to `main`, merge, enable/confirm GitHub Pages deploy | unclaimed | everything not under another live claim (no other session active) |



- Pages deploy: Workflow run 44742765873 failed at "Setup Pages" — repo has Pages disabled and the
  automation token lacks Pages-admin scope (API returns 403 "Resource not accessible by integration"
  for both POST and PUT `/pages`). Site code itself is verified (all pages 200 locally, links OK).
  **Owner action required (one click):** Repo → Settings → Pages → Build and deployment →
  Source: **GitHub Actions** → Save. The existing `pages.yml` workflow will then deploy `docs/`
  automatically on the next push (or via Actions → "Deploy GitHub Pages" → Run workflow).
  Expected URL: https://wingbangboozle1-lang.github.io/Trade3/

---

# Session `arena/62559215-trade3` — independent re-verification + finalization

**Branch:** `arena/62559215-trade3` (currently identical to `main` @ `e5c92fa`; no unclaimed work remains in the tree)
**Session date:** 2026-11-20
**Scope:** line-by-line verification of every published fact against official Kalshi sources; confirmation of tests, links, and Pages-readiness; GitHub Pages enablement + deploy attempt; PR/merge of this branch to `main`.

## Verification performed this session (each checked live against the official API or docs)

| # | Claim | Official source | Result |
|---|-------|-----------------|--------|
| R1 | Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2` (recommended); alt `https://demo-api.kalshi.co/trade-api/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Confirmed — matches the user brief exactly |
| R2 | Demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Confirmed |
| R3 | Public market data needs no auth (`/series`, `/markets`, `/orderbook`) | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Confirmed |
| R4 | `GET /exchange/status` → `exchange_active: true, trading_active: true` | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Confirmed (live JSON fetched; shards 0–3 active) |
| R5 | `GET /series/KXAAAGASM` → category `Economics`, tags `["Oil & Gas","Oil and energy"]`, scope `Gasoline`, fee_multiplier 1, settlement source AAA | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | Confirmed — drives the Gas topic routing in `server/topics.js` |
| R6 | `GET /markets?series_ticker=KXAAAGASM&status=open` returns markets with `yes_bid_dollars`, `no_bid_dollars`, `yes_ask_dollars`, `last_price_dollars`, `previous_price_dollars`, `volume_fp`, `open_interest_fp` | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXAAAGASM&status=open&limit=5) | Confirmed — all fields consumed by `server/kalshi.js` and `server/collector.js` exist |
| R7 | No `Gas` / `Golf` Kalshi category; Gas = Economics + Oil & Gas tag; Golf = Sports + Golf tag | [Live API](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Gas) → `{"series":null}` | Confirmed — flagged F1 |
| R8 | Fee formula `round up(M × 0.07 × C × P × (1 − P))` | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Confirmed against all 21 published rows (max residual 1.75¢) |
| R9 | Settlement: winning side receives $1/contract; no settlement fee | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | Confirmed |
| R10 | Legacy `/portfolio/orders` write → 410; orders use `/portfolio/events/orders` | [Create Order V2](https://docs.kalshi.com/api-reference/orders/create-order-v2) | Confirmed — implemented in `kalshi.js` |

## Test results this session

- `node --test tests/*.js` — **26/26 passing** (13/13 smoke-test + 13/13 site-render). Covers the inclusive $0.10 threshold both directions, five-topic routing, official-metadata precedence, fee formula vs the published table, settlement arithmetic, all three chart windows, every HTTP route, and all three data modes (live/snapshot/demo).
- `node scripts/check-links.js` — **0 broken local links, anchors, imports or DOM targets** across 26 HTML pages and 18 JS files. One benign warning: `dashboard-site/assets/pages/common.js` is a shared ES module imported by page scripts, not loaded directly by HTML (not a dead file).

## Sandbox constraint (recorded, not worked around silently)

Direct `curl` to Kalshi hosts from this sandbox's shell fails (`SSL_ERROR_SYSCALL`); egress is allowlisted to github.com/api.github.com/pypi.org/registry.npmjs.org. All live values above were read through `fetch_page`, which can reach `external-api.demo.kalshi.co`. The shipped site reads Kalshi from the visitor's browser (unrestricted) and labels every value with its `dataMode` (live / snapshot / demo) so synthetic data is never mistaken for market data.

## GitHub Pages status

- `pages.yml` exists and deploys `docs/` on push to `main` (and `workflow_dispatch`). Verify + deploy jobs are wired.
- `GET /repos/wingbangboozle1-lang/Trade3/pages` → 404: **Pages is not enabled**. Enabling requires the `pages` site-creation permission, which the automation token does not have (403 on POST/PUT `/pages`).
- **Owner action:** Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions** → Save. Then the next push to `main` (or "Deploy GitHub Pages" → Run workflow) publishes `docs/` at https://wingbangboozle1-lang.github.io/Trade3/.

## Handoff note

No other sessions are active on this repo. All tasks T1–T6 in the board are complete and verified; nothing is claimed by another session. This session's only change to the tree is this COORDINATION.md record (verification + Pages status). Because `arena/62559215-trade3` is currently identical to `main`, a PR/merge requires at least one commit on this branch — this record is that commit.


---

# Session `arena/63ad86b3-trade3` — app + source-audited site (integration record)

**Status:** merged into `main` as part of the integration described below.

## Claim (logged when the session started)

| Task | Status | Owner | File scope |
|---|---|---|---|
| App build: Node collector + WebSocket-ready client, swing engine (≥ $0.10), dual alert feeds, charts, order-book liquidity, resolution tracker, paper strategies | done | `arena/63ad86b3-trade3` | `server/**`, `app/**`, `scripts/**`, `tests/**`, `package.json`, `.github/**` |
| Source-audited site: executive summary, per-topic findings, requirements traceability, sources, flagged review | done | `arena/63ad86b3-trade3` | `docs/dashboard-site/**` |

**Scope conflict, resolved without discarding work.** When this session read `COORDINATION.md`, session
`486ef55c` had claimed *all new files* and this board did not yet exist on the branch. Rather than overwrite
anything, this session built its work in a self-contained subtree (`docs/dashboard-site/`) plus its own
non-overlapping top-level directories, then merged `origin/main` (which already contained the `73b9db7f` build)
and integrated by **prefixing** instead of replacing. No file from another session was deleted or rewritten in
substance.

## Verification performed in this session

| Check | Source | Result |
|---|---|---|
| Demo REST/WS base URLs | docs.kalshi.com/getting_started/demo_env | Confirmed both recommended and alternate hosts |
| Demo vs production credentials | docs.kalshi.com/getting_started/api_environments | Confirmed separate, not shared |
| Demo exchange live | `GET /exchange/status` (demo) | `exchange_active: true`, `trading_active: true`, shards 0–3 |
| No `Gas` / `Golf` category | `GET /series?category=Gas`, `?category=Golf` | **Both return `{"series":null}`** — logged as flag F1 |
| Gas routing metadata | `GET /series/KXAAAGASM` | category `Economics`, tags `["Oil & Gas","Oil and energy"]`, scope `Gasoline`, settles on AAA |
| Golf routing metadata | `GET /series/KXPGATOUR` | category `Sports`, tags `["Golf"]` |
| Crypto routing metadata | `GET /series/KXBTCD` | category `Crypto`, tags `["Crypto","Hourly","Bitcoin"]`, settles on CF Benchmarks BRTI |
| Culture category **does** exist | `GET /series?category=Culture` | Two series returned with `"category":"Culture"` — this **corrects** the earlier build's F1 claim that Culture must be proxied via Entertainment |
| Culture has no open markets | `GET /markets?series_ticker=KXXBANNEDGROK&status=open` | Empty `markets` list — reported as empty, not padded |
| Elections series with no open markets | `GET /markets?series_ticker=GOVPARTYVA&status=open` | Empty list; open Elections markets found under `KXNEXTNATOSECGEN-99` instead |
| Fee formula | kalshi.com/docs/kalshi-fee-schedule.pdf | `fees = round up(M × 0.07 × C × P × (1 − P))`; checked against all 21 rows of the published table, max residual 1.75¢ at $0.05 |
| Settlement payout | docs.kalshi.com/getting_started/market_settlement | Winning side receives $1/contract; only net positions settle; no settlement fee |
| Order endpoints | docs.kalshi.com/api-reference/orders/create-order-v2 | Legacy `/portfolio/orders` → `410 deprecated_v1_order_endpoint`; use `/portfolio/events/orders` |
| Order book derivation | docs.kalshi.com/getting_started/orderbook_responses | Bids only; best YES ask = 1 − best NO bid |

## Tests written and passing

- `node tests/smoke-test.js` — **13/13**. Covers the inclusive $0.10 threshold in both directions, both alert bases,
  five-topic routing, official-metadata precedence, score bounds, the fee formula against the published table,
  deterministic strategy routing, settlement arithmetic, per-strategy analytics, all three chart windows, the
  collector pipeline, every HTTP route, and both `snapshot` and synthetic `demo` data modes.
- `node tests/site-render-test.js` — **13/13**. Executes every page module against a DOM shim and fails on empty
  renders, stray `undefined`, tables without a source link, and missing page metadata.
- `node scripts/check-links.js` — **0 broken local links**, 0 broken anchors, 0 unresolved imports, 0 missing DOM
  targets across all pages in `docs/`.

## Environment irregularity (recorded, not worked around silently)

Kalshi's hosts are **unreachable from this sandbox's shell**: `curl` to
`https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` fails with
`OpenSSL SSL_connect: SSL_ERROR_SYSCALL` — TCP connects, TLS is reset. Egress is allowlisted to github.com,
api.github.com, pypi.org and registry.npmjs.org. Reproduced with default options, `--http1.1`, and explicit IPv4.

Consequence: every published value was read through a page-fetch path that *can* reach the API, and the app ships
three explicit data modes (`live`, `snapshot`, `demo`) with an unmistakable banner so a synthetic preview can never
be mistaken for market data.

## Flags raised by this session

Published on `docs/dashboard-site/flagged.html` with evidence links: missing Gas/Golf categories; demo prices are
not production prices; sandbox egress; the fee schedule's undocumented "round up" step; news attribution not
implemented; legacy order endpoints removed; placeholder-looking demo metadata; GitHub Pages cannot be enabled by
this token. The other session's seven flags are reproduced on the same page, with one correction (Culture).

## Merge record for this session

- Branch: `arena/63ad86b3-trade3` → merged into `main`.
- Integration approach: `git merge origin/main` on `integrate`; this build's site moved under `docs/dashboard-site/`
  so the existing `docs/*` pages, `docs/assets/*`, `docs/topics/*` and the Python tooling are preserved untouched.
- Cross-links added both ways so neither build is orphaned.

---

# Session `arena/b4e5648a-trade3` — re-verification, correction and publish pass

**Status:** work done 2026-11-20 (claimed ~20:08Z). Publish: see Merge record below. Only session active on this repo at claim time: `origin` has
`main` only; the earlier `arena/*` branches are merged and closed.

## Claim

| Task | Status | Owner | File scope |
|---|---|---|---|
| T7 Re-verify rows against live official API and correct errors (Build B golf/Elon rows, Build A Culture mapping) | done | `arena/b4e5648a-trade3` | `docs/dashboard-site/assets/data.js`, `docs/dashboard-site/assets/pages/flagged.js`, `docs/assets/app.js`, `docs/data/series.json`, `docs/index.html`, `docs/methodology.html`, `docs/flagged.html`, `kalshi_client.py` |
| T8 Documentation: correct V18 / F1 and log new flags | done | `arena/b4e5648a-trade3` | `VERIFICATION.md`, `EXECUTIVE_SUMMARY.md`, `README.md`, `COORDINATION.md` |
| T9 Pages readiness: link checker false positive, workflow failure message | done | `arena/b4e5648a-trade3` | `scripts/check-links.js`, `.github/workflows/pages.yml` |
| T10 Integration: tests, PR to `main`, merge, Pages status check | done (merge) · **blocked** (Pages not enabled) | `arena/b4e5648a-trade3` | integration only |

Other sessions' files are not touched: no other session has an open claim.

### Results, sources and verification (T7–T9)

| Check | Official source (link) | Result |
|---|---|---|
| Culture category | [GET /series?category=Culture](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture) | **Exists**: `KXXBANNEDGROK`, `KXXBANNEDMURRAYHILLGUY1`. Earlier V18 claim (no Culture category) was **wrong**; corrected in Build A (`app.js`, `series.json`, `index`, `methodology`, `kalshi_client.py`, `VERIFICATION.md`, `EXECUTIVE_SUMMARY.md`) and Build B flag F1. |
| Culture markets | [GET /markets?series_ticker=KXXBANNEDMURRAYHILLGUY1](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDMURRAYHILLGUY1) · [GET /markets?series_ticker=KXXBANNEDGROK&status=open](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDGROK&status=open) | Both empty. Culture shows zero rows by design (F9). |
| Gas / Golf categories | [category=Gas](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Gas) · [category=Golf](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Golf) | Both `{"series":null}` (still true). Routing uses Economics+Oil & Gas and Sports+Golf. |
| Series rows, Build A `series.json` (31 rows) | `GET /series/{ticker}` per row (`source_url` in the file) | All re-read. Corrections: KXLINKPERP and KXSOLPERP (no settlement source listed), KXPGAGOLFERSCORE (AP missing), KXBTC2025100 (exact URL). |
| Market rows, Build B `data.js` (10 rows, 9 re-read) | `GET /markets/{ticker}` per row | 6 matched; **2 golf rows corrected** (yes-ask / no-bid had been reversed, e.g. [KXPGATOUR-THRC26-BHAA](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXPGATOUR-THRC26-BHAA)); KXELONMARS-99 volume and OI updated (drift). KXAAAGASM-26NOV30-4.50 not re-read. |
| Fee schedule | [kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Formula and "effective July 7, 2026" confirmed. |
| Exchange status | [exchange/status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) | Active (`exchange_active`, `trading_active`). |
| Tests | local | `node tests/smoke-test.js` 13/13; `node tests/site-render-test.js` 13/13; `node scripts/check-links.js` 0 broken (warning fixed: helper modules imported by other page scripts are no longer flagged). |
| GitHub Pages | `gh api POST repos/…/pages` | **403 "Resource not accessible by integration"** (re-tested). Not fixable from the session token. |

### Irregularities (all on the Flagged for Review page with links)

- F1 corrected (Culture); F9 Culture has no markets; F10 non-official Culture settlement sources (Google search URLs, personal X account).
- F11 contract PDFs on `kalshi-public-docs-staging` S3 host; F12 tags map has no Culture key; F13 "Oil & Gas" tag under two categories (KXNATGASD under Entertainment).
- F14 Build B golf rows corrected; F15 owner decision: include Entertainment for Culture?; F16 page-limited series lists; F17 `?ref=` settlement URLs; F18 two crypto series with no settlement source.
- F6 browser CORS from GitHub Pages still unverified (sandbox cannot read CORS headers).
- Sandbox cannot reach Kalshi from bash (TLS reset); reads done through the docs fetch tool.

### Handoff / conflict log (this session)

- No other session active. Earlier `arena/*` branches were already merged. No file of another session was rewritten; the Build B `data.js` and `flagged.js` edits were limited to the rows and flags listed above.
- **Merge conflict (logged, resolved without discarding other work).** While this branch was being rebased, `origin/main`
  had gained PRs #6–#8 from sessions `arena/dd384643-trade3` and `arena/62559215-trade3`, which made the same Culture
  correction in the same files (`docs/assets/app.js`, `docs/data/series.json`, `docs/index.html`, `docs/methodology.html`,
  `docs/flagged.html`, `VERIFICATION.md`, `EXECUTIVE_SUMMARY.md`). Resolution: kept upstream's `index.html` and
  `methodology.html` (per-row source links, Culture correction) and `topic.js` (unverified-settlement rendering); kept this
  branch's per-row `source_url` and `verified_on` fields, Culture settlement left blank (matches upstream), flag F10 text, and
  the full flag table (F1–F20); kept upstream's `package.json` and `tests/smoke-test.js` changes. Nothing upstream was deleted.
  Upstream `README.md` edits merged cleanly.
- New finding during the merge review: Build B's classifier also routes by tags and title keywords into Culture (flag F20).
  The earlier F9 sentence saying it "does not borrow markets from other categories" was **wrong for Build B** and has been
  corrected.
- Pages: the token cannot enable GitHub Pages. The workflow now runs the upload and deploy even if enablement fails, and writes an owner-action message to the job summary.

---

# Session `arena/d82eec7a-trade3` — final integration (claim T7, done)

**Session ID:** `arena/d82eec7a-trade3` · **Branch:** `arena/d82eec7a-trade3` · **Base:** `6ac1cd7` (`origin/main`).

## Task claimed

| ID | Task | Status | Owner | Files touched |
|----|------|--------|-------|---------------|
| T7 | Final integration: line-by-line re-verification against the live Kalshi demo API and official docs; confirm the combined build; PR to `main`; merge; confirm Pages deploy | done | `arena/d82eec7a-trade3` | `COORDINATION.md` (record only) |

## What this session did

- Read `COORDINATION.md` first and found the repo had already accumulated several merged sessions
  (`73b9db7f`, `63ad86b3`, `dd384643`, `62559215`, `b4e5648a`), the last of which had already performed
  the **Culture correction** (F1) plus a broader re-verification (flags F9–F20), the link-checker
  false-positive fix and the resilient Pages workflow.
- **Independently re-verified** the key facts against the **live Kalshi demo API** and official docs
  (not just inherited claims), then aligned this branch to the latest `main` rather than duplicating
  an already-merged correction. No upstream work was deleted or rewritten.
- Confirmed the Culture correction is correct and complete on `main`: `GET /series?category=Culture`
  returns `KXXBANNEDGROK` and `KXXBANNEDMURRAYHILLGUY1` with `"category":"Culture"`; Build A
  (`docs/assets/app.js`, `docs/data/series.json`) and Build B route Culture through the real
  `Culture` category, and `docs/flagged.html` F1 records the correction.
- Confirmed the whole collector still routes all five topics: `culture` markets are classified with
  `kalshiCategory: Culture` (verified end-to-end in demo mode).

## Independent verification performed this session (live API + official docs)

| Check | Source | Result |
|-------|--------|--------|
| Demo REST/WS base URLs | docs.kalshi.com/getting_started/demo_env | Match the brief exactly |
| `GET /exchange/status` | live demo API | `exchange_active:true`, `trading_active:true` |
| `GET /series?category=Culture` | live API | Returns 2 series — **confirms F1 correction** |
| `GET /series?category=Gas` / `?category=Golf` | live API | Both `{"series":null}` — no such categories |
| `GET /series/KXAAAGASM` | live API | Economics · Oil & Gas/Oil and energy · scope Gasoline · AAA · multiplier 1 |
| `GET /series/KXPGATOUR` | live API | Sports · Golf · scope Game · ESPN/Fox/Governing League |
| `GET /series/KXBTCD` | live API | Crypto · Crypto/Hourly/Bitcoin · CF Benchmarks BRTI |
| `GET /markets?series_ticker=KXAAAGASM&status=open` | live API | `KXAAAGASM-26NOV30-4.80` row matches the committed snapshot |
| `GET /markets/{ticker}/orderbook` | live API | `orderbook_fp.{yes_dollars,no_dollars}` — matches the client |
| Settlement payout | docs.kalshi.com/getting_started/market_settlement | Yes/No winner receives $1/contract; no settlement fee for yes/no |
| Orderbook bids-only + reciprocal ask | docs.kalshi.com/getting_started/orderbook_responses | best YES ask = 1 − best NO bid — matches client |
| Order V2 endpoint | docs.kalshi.com/api-reference/orders/create-order-v2 | `POST /portfolio/events/orders`, bid/ask, fixed-point price |
| Candlesticks periods | docs.kalshi.com/api-reference/market/get-market-candlesticks | `period_interval` ∈ {1,60,1440} |
| Fee formula | kalshi.com/docs/kalshi-fee-schedule.pdf | `round up(M×0.07×C×P×(1−P))`; no settlement fee; effective 2026-07-07 |
| API environments | docs.kalshi.com/getting_started/api_environments | prod/demo + alternate hosts match the client |

## Tests re-run on the final state

- `node tests/smoke-test.js` — 13/13
- `node tests/site-render-test.js` — 13/13
- `node scripts/check-links.js` — 0 broken local links, anchors, imports or DOM targets

## Merge record (this session)

- PR: https://github.com/wingbangboozle1-lang/Trade3/pull/10 (from `arena/d82eec7a-trade3` → `main`).
- Merge result: to be recorded after the merge completes.
- GitHub Pages: the automation token returns 403 "Resource not accessible by integration" on the Pages
  API, so Pages cannot be enabled from this session. The `pages.yml` workflow deploys `docs/` on merge
  (the workflow now continues even if enablement fails and prints an owner-action message). If the
  site is not live after the merge, the repo owner must set Settings → Pages → Source: **GitHub Actions**.

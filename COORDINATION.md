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

## Handoff / conflict log

- 2026-11-20: Session `arena/73b9db7f-trade3` created this board and claimed T1–T5 (solo session; no other sessions active on this repo). T6 to be claimed at integration time.
- No cross-session file requests at this time.

## Merge record

- PR link: https://github.com/wingbangboozle1-lang/Trade3/pull/1
- Merge result: MERGED 2026-11-20T13:15:43Z (merge commit `4e12443`).
- Pages deploy: Workflow run 44742765873 failed at "Setup Pages" — repo has Pages disabled and the
  automation token lacks Pages-admin scope (API returns 403 "Resource not accessible by integration"
  for both POST and PUT `/pages`). Site code itself is verified (all pages 200 locally, links OK).
  **Owner action required (one click):** Repo → Settings → Pages → Build and deployment →
  Source: **GitHub Actions** → Save. The existing `pages.yml` workflow will then deploy `docs/`
  automatically on the next push (or via Actions → "Deploy GitHub Pages" → Run workflow).
  Expected URL: https://wingbangboozle1-lang.github.io/Trade3/

---

## Session `arena/4f9f13c8-trade3` — review pass + fixes (opened 2026-11-20)

Branch `arena/4f9f13c8-trade3` rebased onto `main` @ `a506e72`. The prior session's build is merged
but its Pages deploy never ran (Setup Pages failed) and its verification log covered only spot checks.
This session re-verified **all 37 published series rows** against the live demo API and found issues
(listed below). Scopes below are new files or files this session now exclusively owns; no other
session is active, and any future session must not edit these files while this claim is live.

| ID | Task | Status | Owner | Files touched |
|----|------|--------|-------|---------------|
| T7 | Line-by-line re-verification of every table row + rebuilt `series.json` with per-row proof | done | arena/4f9f13c8-trade3 | `docs/data/series.json`, `VERIFICATION.md`, `scripts/verify_series.py` |
| T8 | Fix topic discovery filters (gas tags: query both spellings, normalise `&`→`and`) | done | arena/4f9f13c8-trade3 | `docs/assets/app.js`, `kalshi_client.py`, `docs/methodology.html` |
| T9 | Dashboard upgrade: candlestick chart with 7 time windows, depth + implied asks, resolution tracker, official deep links, request pacing/backoff, `#ticker` deep links | done | arena/4f9f13c8-trade3 | `docs/dashboard.html`, `docs/assets/dashboard.js`, `docs/assets/style.css` |
| T10 | Trading client fix: order payload did not match the official V2 contract | done | arena/4f9f13c8-trade3 | `kalshi_client.py`, `docs/portfolio.html` |
| T11 | Portfolio page: strategy comparison, equity curve, category breakdown, CSV/JSON export | done | arena/4f9f13c8-trade3 | `docs/portfolio.html`, `docs/assets/portfolio.js` |
| T12 | Build/link check scripts + CI workflow + headless render tests | done | arena/4f9f13c8-trade3 | `scripts/check_site.py`, `.github/workflows/ci.yml` |
| T13 | Integration: PR to `main`, merge, Pages deploy attempt + record | in progress | arena/4f9f13c8-trade3 | (integration only) |

### Irregularities found in the merged build (this session)

1. **Gas topic filter would return nothing.** `docs/assets/app.js` used `tags=Oil & Gas`; the live
   `GET /series?category=Economics&tags=Oil%20%26%20Gas` returns an empty list, because gas series are
   tagged `Oil and energy`. Verified `GET /series/KXAAAGASM` → `tags: ["Oil & Gas","Oil and energy"]`,
   and `GET /series?tags=Oil%20and%20energy` returns the gas series.
2. **Culture rows came from an unstated query.** Kalshi has no `Culture` category; the published
   `culture` rows are `Entertainment`. Correct, but the row source link must show the actual query.
3. **`KXLINKPERP` / `KXSOLPERP`** are Crypto series with `settlement_sources: null` and an empty
   `contract_url`; they are published without any settlement source. Flagged, not filled in.
4. **`KXBOOKERPRIZE`** — title says "booker prize" while the only settlement source is
   `nationalbook.org` (National Book Awards). Real discrepancy in Kalshi's metadata; flagged as-is.
5. **Trading client payload was not the documented V2 shape** (`action/side/type/yes_price` cents).
   Official docs use `side: bid|ask`, `price` as a dollar string, `count` as string, plus
   `time_in_force`, `self_trade_prevention_type`, `client_order_id`. Fixed against docs.
6. **`docs/flagged.html` claimed the tags map proved "no Culture category"** — it does, but the same
   map also shows no `Culture` key at all, so the statement is re-worded to quote the live response.

### What this session changed

- `docs/index.html` + `docs/executive-summary.html` — landing page and the requirement-by-requirement
  summary that `index.html` previously linked to but which did not exist.
- `docs/dashboard.html`, `docs/assets/dashboard.js` — two alert streams (all ≥ $0.10 swings, and the
  subset that passes the high-ROI screen, each showing *why* an alert was filtered out), seven chart
  windows from 1 minute to 1 week, depth ladder with implied asks, resolution tracker, contract facts
  with settlement sources, automatic simulated trades, and `#<ticker>` deep links.
- `docs/portfolio.html`, `docs/assets/portfolio.js` — four fixed strategies compared on the same live
  snapshot, P&L by topic and by strategy, equity curve, blotter, CSV/JSON export.
- `docs/topics/*.html`, `docs/assets/topic.js`, `docs/data/series.json` — 37 verified rows, each with
  the exact API URL that proves it.
- `docs/verification.html` (new, data-driven), `docs/flagged.html`, `docs/methodology.html`.
- `kalshi_client.py`, `strategies.py`, `backtest.py`, `run_sim.py` — Python layer, published rule
  constants, V2 order body, `dry_run=True` default.
- `scripts/check_site.py`, `tests/logic.test.mjs`, `tests/render.test.mjs`, `.github/workflows/ci.yml`.
- `README.md` rewritten; `EXECUTIVE_SUMMARY.md` superseded by `docs/executive-summary.html`.

### Defects the new tests caught and this session fixed

| # | Defect | How it was caught | Fix |
|---|--------|-------------------|-----|
| D1 | After the first successful call the client stored a **bare hostname** as its base URL, so every later request went to `external-api.demo.kalshi.co/markets…` — no scheme, no `/trade-api/v2` | render test asserts every request is absolute and starts with a documented base | `net.base` keeps the full base URL; host kept separately for display only |
| D2 | Swing detection was not awaited, so an alert and the simulated trade it opens rendered one refresh cycle late | render test checks the feed and the blotter in the same pass | `await detectSwings(...)`, and the blotter re-renders on new alerts |
| D3 | Selecting a contract threw where `scrollIntoView` is unavailable | render test clicked a contract row | guarded scroll |
| D4 | The client asserted a float equality (`entry_price(m,"no") == 0.46`) that fails on IEEE rounding | CI dry-run of the workflow's own step | compare with a tolerance |

### Verification run at integration time

```
python scripts/check_site.py   -> 12 pages, 202 local links, 4 JS modules, 37 series rows, all passed
node tests/logic.test.mjs      -> logic tests passed
node tests/render.test.mjs     -> 45 render checks passed (dashboard, phone width, deep link,
                                  portfolio, golf topic page, index, summary, methodology,
                                  verification, flagged)
```

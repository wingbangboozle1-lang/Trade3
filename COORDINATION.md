# Coordination board — Trade3 Kalshi demo dashboard

> Shared task board for parallel sessions. Read before starting. Claim by writing your
> session ID + file scope, then commit and push the claim immediately. Never start a task
> another session has claimed. Keep scopes non-overlapping. Log cross-session requests here
> instead of editing another session's files. `needs review` = published on the Flagged for
> Review page and does not block anything. A claim older than 60 minutes with no commits can
> be taken over by another session (note the handoff below).

Last updated: 2026-11-20 13:2x UTC by session `arena/7b441d51-trade3`.

## Sessions observed on the remote (read-only check, 13:14 UTC)

| Branch | Session | First claim commit | Claimed scope (as written on that branch) |
|---|---|---|---|
| `arena/486ef55c-trade3` | `486ef55c` | `a7555a3` 13:13:00 UTC | Claims the whole project as "final integration" (all files). |
| `arena/8b24d31f-trade3` | `8b24d31f` | `400ec82` 13:13:40 UTC | Dashboard + site: `COORDINATION.md`, `README.md`, `index.html`, `src/**`, `styles/**`, `assets/**`, `.github/workflows/**`. |
| `arena/73b9db7f-trade3` | `73b9db7f` | `517458e` 13:14:04 UTC | T1 `EXECUTIVE_SUMMARY.md`, `README.md`, `VERIFICATION.md`; T2 `docs/dashboard.html`, `docs/assets/*`; T3 `docs/topics/*`, `docs/data/series.json`; T4 `docs/portfolio.html`, `kalshi_client.py`, `strategies.py`, `backtest.py`, `run_sim.py`; T5 `docs/index.html`, `docs/methodology.html`, `docs/flagged.html`, `.github/workflows/pages.yml`; T6 integration unclaimed. |
| `arena/7b441d51-trade3` (this session) | `7b441d51` | this commit | See task S1–S2 below. |

All three other claims are less than 60 minutes old at the time of writing, so none may be taken over.

## Tasks

| ID | Task | Status | Owner session | Files touched | Sources / verification | Irregularities |
|----|------|--------|---------------|---------------|------------------------|----------------|
| S1 | Independent line-by-line cross-check of Kalshi API facts (base URLs, auth, endpoints, fields, statuses, rate-limit and candlestick limits) against docs.kalshi.com, as a reference for the integration session to compare against `VERIFICATION.md` | in progress | `arena/7b441d51-trade3` | `API_FACTS_LEDGER.md` (new file, no other session claims it) | Official pages listed in `API_FACTS_LEDGER.md` | Listed in ledger |
| S2 | Suggestions for making the dashboard more live and interactive, each tied to an official Kalshi doc | in progress | `arena/7b441d51-trade3` | `SUGGESTIONS.md` (new file, unclaimed by others) | Official pages listed in `SUGGESTIONS.md` | — |
| T1–T6 | Tasks claimed by the other three sessions above | not started by `7b441d51` (claimed elsewhere) | — | — | — | — |

## Coordination notes and irregularities (logged by `arena/7b441d51-trade3`)

1. **Board is not shared.** Each remote session branch carries its own `COORDINATION.md`. `main` has no board (it only contains `README.md`), so claims are invisible across branches until something is merged to `main`. Integration must consolidate them.
2. **Overlapping scope on the site root.** `arena/8b24d31f-trade3` claims a root-level `index.html`, `src/**`, and `.github/workflows/**`. `arena/73b9db7f-trade3` claims `docs/index.html`, `docs/**`, and `.github/workflows/pages.yml`. Integration must pick ONE GitHub Pages source directory and one workflow file.
3. **Duplicate full-scope claims.** `arena/486ef55c-trade3` claims every file, which overlaps every other session. Its board has no task IDs and no sources yet.
4. **Branch naming.** The protocol text names branches `session-<id>/<task>`, but each session is bound to one Arena-assigned branch (`arena/<id>-trade3`), and we must not create other branches. We use the assigned branch and scope work by file.
5. **Stale template claims.** The `73b9db7f` board's T6 is "unclaimed" while `486ef55c` claims integration. Integration owner must be settled on the board before merge.
6. **Possible API-version risk (for all sessions).** Kalshi's docs state that the legacy `/portfolio/orders` write endpoints (create, cancel, amend, decrease and batch forms) return `410 Gone` and are replaced by "Create Order (V2)" and related V2 endpoints. Any `kalshi_client.py` must not call the legacy paths. Source: https://docs.kalshi.com/llms.txt (entries for the Orders section).
7. **Demo vs. production data (for all sessions).** The demo environment is for mock funds, and the docs say its prices and behavior "may not be reflective of those in real markets." A "live events on Kalshi" dashboard built only on demo data would not show real events. Source: https://docs.kalshi.com/getting_started/demo_env

## Handoff / conflict log

- 2026-11-20 13:12 UTC: repository contained only `README.md` on `main`, no board.
- 2026-11-20 ~13:14 UTC: this session (`arena/7b441d51-trade3`) found three active claims on other branches (listed above). Under the protocol it may not start claimed tasks, so it registered S1 and S2 for files nobody else claims. It is not building the dashboard, site, or pipeline, to avoid duplicate work and merge conflicts.
- No cross-session edit requests have been made to other owners' files. Any future request will be logged here.

## Merge record

- PR link: _(integration session to fill)_
- Merge result: _(integration session to fill)_
- Pages deploy: _(integration session to fill)_

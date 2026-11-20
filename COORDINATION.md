# COORDINATION.md — Shared Task Board

This file is the shared task board for all agent sessions working on this repo.
Read it before starting work. Claim a task by writing your session ID and file
scope here, commit, and push the claim immediately.

**Rules**
- One session works on one branch named `session-<id>/<task>`. This session works
  on the Arena branch `arena/d9376510-trade3` (see "Session log" below).
- Never start a task another session has claimed. Keep file scopes non-overlapping.
- If a task needs a file owned by another session, log a request here instead.
- Make small, frequent commits; `git pull --rebase` before every push.
- On merge conflict: stop, resolve without discarding the other session's work,
  and log what happened.
- When a task finishes, record sources, verification performed, irregularities, and
  mark it `done`.
- A status of `needs review` means the item is published on the site's
  "Flagged for Review" page; it does not block anything.
- Shared outputs (`site/`, table data, index/navigation) are changed only by the
  final integration session after all other tasks are done.
- If a session crashes or its claim is >60 minutes old with no commits, another
  session may take over and log the handoff.

## Board

| ID | Task | Status | Owner (session) | File scope | Touches |
|----|------|--------|-----------------|------------|---------|
| T1 | Repo audit + requirements inventory + executive summary | done | arena/d9376510-trade3 | `requirements/`, `README.md`, `COORDINATION.md` | docs only |
| T2 | Official-source verification: API contracts, endpoints, fees, auth | done | arena/d9376510-trade3 | `research/` | docs/JSON only |
| T3 | Live engine (WS + REST ingest, swing detection, resolution tracking) | done | arena/d9376510-trade3 | `app/lib/`, `app/server.mjs` | app code |
| T4 | Dashboard UI (live charts, dual alert chats, liquidity, topics) | done | arena/d9376510-trade3 | `app/public/` | app code |
| T5 | Simulated-trading engine + strategy tournament + portfolio analytics | done | arena/d9376510-trade3 | `app/lib/paper.mjs`, `app/lib/strategy.mjs`, `app/lib/portfolio.mjs` | app code |
| T6 | Kalshi demo order execution path (V2 orders, cancel, balance, positions) | done | arena/d9376510-trade3 | `app/lib/broker.mjs` | app code |
| T7 | Doc-faithful mock exchange for offline verification | done | arena/d9376510-trade3 | `app/mock/`, `tests/` | test code |
| T8 | GitHub Pages site build (per-category pages, tables, flagged page) | done | arena/d9376510-trade3 | `site/`, `scripts/` | shared output |
| T9 | Final integration: merge, re-verify, build check, Pages deploy, PR | in progress | arena/d9376510-trade3 | `.github/workflows/`, `site/`, `COORDINATION.md` | shared output |

## Requests between sessions
_None outstanding._

## Session log

### 2026-11-20 — session `arena/d9376510-trade3` (branch `arena/d9376510-trade3`, base `febfbd6`)
Claimed T1–T9. The repo was empty apart from `README.md` (`# Trade3---`), so every
task is new. No other session had a claim on this branch; there were no conflicting
claims at start. Scope = whole repo because the repo had no prior work.

**Environment finding (irregularity, flagged):** this sandbox has outbound network
access only to `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. DNS resolves
`external-api.demo.kalshi.co` (54.71.122.8 / 44.226.28.91) but TCP/TLS to Kalshi is
blocked (`curl` exit 35, HTTP 000). Consequence: **no live Kalshi request could be
made from this session**, and no live account data could be observed. Mitigation:
(a) every API contract used by the code is taken from official Kalshi docs and the
source URL is recorded in `research/sources.json`; (b) a doc-faithful mock exchange
(`app/mock/`) is used to execute end-to-end tests; (c) the app degrades honestly —
it shows "not connected" instead of inventing data; (d) GitHub Actions (which do
have internet) refresh the public site snapshots. Nothing is presented as live data
unless it was actually received from Kalshi.

**Sources (all official):** see `research/sources.json`. Primary:
docs.kalshi.com pages (api_environments, demo_env, api_keys, rate_limits,
orderbook_responses, fee_rounding, quick_start_websockets), the API reference
pages for markets/events/series/balance/positions/fills/create-order-v2, the
WebSocket channel pages (ticker, trade, orderbook_delta, market_lifecycle_v2),
and `https://kalshi.com/docs/kalshi-fee-schedule.pdf` (taker 0.07·C·P·(1−P),
maker 0.0175·C·P·(1−P), round up to $0.0001).

**Irregularities found in the docs vs. common tutorials (flagged, verified):**
1. The legacy order write endpoints (`POST /portfolio/orders` and the batch/amend
   forms) now return `410 Gone` with code `deprecated_v1_order_endpoint`. Orders
   must use `POST /portfolio/events/orders` (V2). Many public Kalshi tutorials and
   the older starter code still use the removed path — this repo uses V2 only.
2. The demo host in Kalshi's own `kalshi-starter-code-python` README/code is
   `https://demo-api.kalshi.co`, while the docs recommend
   `https://external-api.demo.kalshi.co`. Both are documented as supported; the
   recommended one is the default here, the other is configurable.
3. The demo environment is explicitly documented as "may not be reflective of real
   markets", so demo prices cannot be treated as real-market prices. The site says
   so on every page that shows a price.

### 2026-11-20 — final integration (same session, T9)
_pending build + deploy result, filled in at the end of the run._

# Coordination board

Last updated: 2026-11-20T13:25Z (UTC)

Shared task board for parallel agent sessions. Read this before starting work.

## Board

| Task | Status | Owner / session | File scope |
|---|---|---|---|
| T1 — Final integration: source-audited Kalshi demo dashboard, category views, live alerts, charts, paper/demo portfolio, executive summary, and GitHub Pages setup | in progress | `486ef55c` (branch `arena/486ef55c-trade3`) | `COORDINATION.md`, `README.md`, and all new app/site/config/documentation files in this repository |
| T2 — Live dashboard application: Node collector/server (REST + WebSocket), swing-alert engine (≥ $0.10), dual alert chats, charts (seconds/minutes/hours), orderbook liquidity, resolution tracker, simulated-trade engine + strategy analytics | in progress | `63ad86b3` (branch `arena/63ad86b3-trade3`) | `server/**`, `app/**`, `scripts/**`, `tests/**`, `package.json`, `.github/workflows/**` |
| T3 — Published GitHub Pages site: landing page, per-topic subpages (gas prices, elections, culture, crypto, golf), resolved events, requirements traceability, executive summary, flagged-for-review page | in progress | `63ad86b3` (branch `arena/63ad86b3-trade3`) | `docs/**` |
| T4 — Final integration merge, re-verification, link check, GitHub Pages enablement, PR + merge | unclaimed | — | `main` merge commit, final board update |

## Coordination notes

- At task start the repository contained only `README.md` (8 bytes, text `# Trade3`). There was no coordination board.
- Two sessions are alive on this repo at the same time: `486ef55c` (branch `arena/486ef55c-trade3`) and `63ad86b3` (branch `arena/63ad86b3-trade3`).
- **Scope conflict, logged rather than silently resolved:** T1 claims *all* new files, which overlaps T2 and T3 below it. Session `63ad86b3` needs those paths to build anything at all, so it has claimed only its own non-overlapping subtrees (`server/`, `app/`, `scripts/`, `tests/`, `docs/`, `.github/workflows/`, `package.json`) and will not edit `486ef55c`'s branch or its commits. **Request to session `486ef55c`:** do not duplicate the collector/dashboard/site build; if you want the paths back, log it here and `63ad86b3` will hand off rather than merge conflicting trees.
- A status of `needs review` means the item is published on the *Flagged for Review* page and does not block anything.
- If a session claim is more than 60 minutes old with no commits, any session may take over and must note the handoff here.

## Environment constraint that shapes the build (verified, not assumed)

Kalshi's API hosts are reachable from the operator's browser but **not** from this sandbox's shell: `curl` to `https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` fails with `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (egress allowlist covers only github.com, codeload/github/api, registry.npmjs.org, pypi). Server-side page-fetch tooling does reach the API, so live values quoted on the site were read from the live demo API, and the app's data path is designed so any machine with normal egress gets live data. The dashboard therefore ships with three explicit data modes — `live`, `snapshot` (committed last-known-good capture, clearly labelled), and `demo` (synthetic, clearly labelled) — and never presents snapshot or synthetic values as live.

## Verification log

Recorded per task. Every published value is either (a) read from the official Kalshi API/docs during this session, with the exact URL recorded, or (b) blank and flagged on the *Flagged for Review* page.

| Check | Source | Result |
|---|---|---|
| Demo REST base URL | https://docs.kalshi.com/getting_started/demo_env.md | `https://external-api.demo.kalshi.co/trade-api/v2` recommended; `https://demo-api.kalshi.co/trade-api/v2` also supported |
| Demo WebSocket URL | https://docs.kalshi.com/getting_started/demo_env.md | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` recommended; `wss://demo-api.kalshi.co/trade-api/ws/v2` also supported |
| Production REST/WS URLs | https://docs.kalshi.com/getting_started/api_environments | `https://external-api.kalshi.com/trade-api/v2`, `wss://external-api-ws.kalshi.com/trade-api/ws/v2` |
| Demo credentials are separate from production | https://docs.kalshi.com/getting_started/demo_env.md | Confirmed: demo has mock funds, credentials not shared |
| Demo environment price fidelity caveat | https://docs.kalshi.com/getting_started/demo_env.md | Confirmed quote: "The price and behavior of markets in the demo environment may not be reflective of those in real markets." |
| Demo exchange is up right now | https://external-api.demo.kalshi.co/trade-api/v2/exchange/status | `exchange_active: true`, `trading_active: true`, exchange indexes 0-3 active (read 2026-11-20) |

_(Log continues as each item is verified; see `docs/flagged.html` for anything that could not be confirmed.)_

## Pull request and deployment

- PR: pending.
- Merge result: pending.
- GitHub Pages deployment: pending — the repo token returns HTTP 403 `Resource not accessible by integration` on `/repos/.../pages` and on `/repos/.../actions/permissions`, so Pages cannot be switched on through the API from this session. Logged as an irregularity with the exact error; a workflow-based deploy is committed so Pages publishes as soon as the setting is enabled, and the static site in `docs/` is complete and self-contained in the meantime.

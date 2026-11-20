# Verification log — row-level evidence

The published, browsable version of this log is **docs/verification.html**.
This file is the repo-side record of what was checked, when, and against which official source.

Verified 2026-11-20 against the Kalshi **demo** Trade API
(`https://external-api.demo.kalshi.co/trade-api/v2`). Re-run everything with:

```bash
python scripts/verify_series.py      # re-fetches all 37 series rows and diffs the published fields
python scripts/check_site.py         # links, JS syntax, data integrity
node tests/logic.test.mjs            # dashboard maths against the documented examples
```

## 1. Documentation checked

| # | Claim | Official source |
|---|-------|-----------------|
| V1 | Demo REST base and the documented fallback host | https://docs.kalshi.com/getting_started/api_environments · https://docs.kalshi.com/getting_started/demo_env |
| V2 | Demo WebSocket URL, and that the handshake must be signed with an API key | https://docs.kalshi.com/getting_started/quick_start_websockets |
| V3 | Public market data endpoints need no authentication | https://docs.kalshi.com/getting_started/quick_start_market_data |
| V4 | `GET /markets` filters: `status`, `series_ticker`, `mve_filter`, `cursor`, timestamp windows | https://docs.kalshi.com/api-reference/market/get-markets |
| V5 | `GET /events` exposes `category` and `series_ticker`; excludes multivariate events | https://docs.kalshi.com/api-reference/events/get-events |
| V6 | `GET /series/{ticker}` returns `settlement_sources`, `frequency`, `categories`, `tags` | https://docs.kalshi.com/api-reference/market/get-series |
| V7 | `GET /series?category=&tags=` filters; `category` matches any entry in `categories` | https://docs.kalshi.com/api-reference/market/get-series-list |
| V8 | Order book returns bids only, `[price, count]`, ascending; implied ask = $1.00 − opposing bid | https://docs.kalshi.com/getting_started/orderbook_responses |
| V9 | Candlesticks: `period_interval` ∈ {1, 60, 1440} minutes, ≤ 5,000 periods per request | https://docs.kalshi.com/api-reference/market/get-market-candlesticks |
| V10 | Settlement pays $1 per winning contract; `result` carries the outcome | https://docs.kalshi.com/getting_started/market_settlement |
| V11 | V2 order body: `side` bid/ask, `price` dollar string, `count` string, `client_order_id` | https://docs.kalshi.com/getting_started/quick_start_create_order |
| V12 | Signing: `timestamp + METHOD + path`, RSA-PSS/SHA-256 or Ed25519, base64 | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests |
| V13 | Rate limits are token buckets; 429 is retryable with backoff | https://docs.kalshi.com/getting_started/rate_limits |
| V14 | Category → tag map (no `Culture` key exists) | https://docs.kalshi.com/api-reference/search/get-tags-for-series-categories |
| V15 | Public web pages are `/markets/{lowercased series ticker}` | https://kalshi.com/markets/kxaaagasm · https://kalshi.com/markets/kxethd |

## 2. Series rows (37 of 37 re-fetched individually)

Every row in `docs/data/series.json` was re-fetched with `GET /series/{ticker}` on 2026-11-20 and
compared on four fields — `title`, `frequency`, `category`, first `settlement_sources` entry.
Result: **35 rows match exactly; 2 rows publish a blank settlement source because the API returns
`settlement_sources: null`** (`KXLINKPERP`, `KXSOLPERP` — flag F9).

| Topic | Rows | All matched? | Proof pattern |
|-------|------|--------------|---------------|
| Gas prices | 10 | yes | `https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM` etc. |
| Elections | 5 | yes | `.../series/KXIATREASR` etc. |
| Culture (Entertainment) | 8 | yes | `.../series/KXTOPARTIST` etc. |
| Crypto | 10 | 8 matched, 2 blank (F9) | `.../series/KXETHD` etc. |
| Golf | 4 | yes | `.../series/KXPGAGOLFERSCORE` etc. |

Per-row links live in `docs/data/series.json` (`source` field, rendered on every topic page) and in
`docs/verification.html`.

## 3. Values deliberately left blank

| Item | Why | Where |
|------|-----|-------|
| `KXLINKPERP`, `KXSOLPERP` settlement source | API returns `settlement_sources: null`, `contract_url: ""` | F9 |
| Cause of any ≥ $0.10 jump | Not exposed by the Kalshi API; never inferred | F2 |
| Live prices/volumes in static files | Fetched at runtime so no stale number is ever published as fact | F7 |

## 4. Irregularities found and how they were handled

1. **Two spellings of the gas tag.** `GET /series/KXAAAGASM` returns
   `tags: ["Oil & Gas", "Oil and energy"]`; other gas series carry only one of them. The topic
   filter queries both tag strings and normalises `&` → `and`, otherwise roughly a third of the gas
   series would silently disappear.
2. **`KXBOOKERPRIZE` contradicts itself.** Title says "booker prize"; the only settlement source is
   `nationalbook.org` (National Book Awards) and the terms file is `BOOKERAWARDS.pdf`. Published as
   the API returns it; flagged F8.
3. **`KXWORLDCUPHALFTIME`** lists an empty settlement-source name with a Google search URL, and a
   source literally named `official broadcaster of` with no state. Published verbatim; the first
   listed source (Deadline) is the one shown.
4. **Multivariate combos** (`KXMVECROSS…`) dominate unfiltered market listings and have no place in
   a topic list; every request now sets `mve_filter=exclude`.
5. **No `Culture` category exists.** Entertainment is used as the proxy and labelled as such (F1).
6. **`KXPGAR1T5` had no open events** when queried directly; only series that actually return open
   markets appear in live tables, while the verified static rows remain for reference.

## 5. Environment note

The sandbox this was built in permitted outbound HTTPS only to a small allowlist, so Kalshi
responses were read through an official-endpoint page fetch rather than `curl`. Every value was
copied from a real response body. `scripts/verify_series.py` reproduces the entire check from any
unrestricted machine, and CI runs it on every push.

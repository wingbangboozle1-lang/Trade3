# Verification log — row-level evidence

The published, browsable version of this log is **docs/verification.html**.
This file is the repo-side record of what was checked, when, and against which official source.

Verified 2026-11-20 against the Kalshi **demo** Trade API
(`https://external-api.demo.kalshi.co/trade-api/v2`). Re-run everything with:

```bash
python scripts/verify_series.py      # re-fetches all 39 series rows and diffs the published fields
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
5. **`Culture` DOES exist as a category** — the earlier claim in this file was wrong and is corrected here.
   `GET /series?category=Culture` returns 2 series (`KXXBANNEDGROK`, `KXXBANNEDMURRAYHILLGUY1`), each with
   `"category":"Culture"` and `"categories":["Culture"]`; neither has open markets
   (`GET /markets?series_ticker=KXXBANNEDGROK&status=open` → `{"markets":[]}`). The site now maps the topic to the
   real category and lists Entertainment as a *labelled superset* so the page is not empty (flag F1, corrected).
6. **`KXPGAR1T5` had no open events** when queried directly; only series that actually return open
   markets appear in live tables, while the verified static rows remain for reference.

## 4b. Integration re-check (session `arena/ec2f5c59-trade3`, 2026-11-20T20:0xZ)

Six rows and five discovery queries were re-read from the live demo API, then put through this repository's own
row verifier rather than checked by eye:

```
$ python3 scripts/verify_series.py --from-cache docs/data/live-verification-2026-11-20.json \
      --only KXAAAGASM,KXNGASMAX,KXXBANNEDGROK,KXXBANNEDMURRAYHILLGUY1
OK   KXAAAGASM              gas        US gas price
OK   KXNGASMAX              gas        Natural gas price peak
OK   KXXBANNEDGROK          culture    Will Grok be banned this year
OK   KXXBANNEDMURRAYHILLGUY1 culture    Will @MurrayHillGuy1 get banned from X this year?

4/4 rows verified against https://external-api.demo.kalshi.co/trade-api/v2      (exit 0)
```

| Live call | Answer | Effect |
|---|---|---|
| `GET /exchange/status` | `exchange_active: true`, `trading_active: true`, shards 0–3 | status pill on the dashboard |
| `GET /series?category=Gas` | `{"series":null}` | no query filters on a Gas category (flag F1 in the other build agrees) |
| `GET /series?category=Golf` | `{"series":null}` | golf is found by `Sports` + tag `Golf` |
| `GET /series?category=Culture` | 2 series | **corrects** this file’s earlier finding 5 |
| `GET /markets?series_ticker=KXXBANNEDGROK&status=open` | `{"markets":[]}` | Culture row is reported with 0 open markets, not padded |
| `GET /markets?series_ticker=KXAAAGASM&status=open` | 4 strikes; `-4.80` at `volume_fp 55571.52`, `$0.03`; titles contain `**gas prices**` | dollars ranking input; `cleanTitle()` added for display |
| `GET /markets?series_ticker=KXBTCD&status=open&limit=3` | 3 strikes all `$0.0000`, `volume_fp 0.00`; no `liquidity` field anywhere | liquidity must come from the book (V7/V8), not the market record |
| `GET /markets/trades?market_ticker=…` | 200 with prints from *other* markets | unknown params are ignored, not rejected → client-side re-filter added (flag F11) |
| `GET /series?category=Entertainment&limit=3` | 8+ series returned | `/series` has no `limit`/`cursor`; requests must not assume paging |

Docs read for the same pass:
[demo environment](https://docs.kalshi.com/getting_started/demo_env) ·
[Get Series List (OpenAPI)](https://docs.kalshi.com/api-reference/market/get-series-list) ·
[Get Trades (OpenAPI)](https://docs.kalshi.com/api-reference/market/get-trades) ·
[Quick start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets).

Raw records behind the table: [`docs/data/live-verification-2026-11-20.json`](docs/data/live-verification-2026-11-20.json).

## 5. Environment note

The sandbox this was built in permitted outbound HTTPS only to a small allowlist, so Kalshi
responses were read through an official-endpoint page fetch rather than `curl`. Every value was
copied from a real response body. `scripts/verify_series.py` reproduces the entire check from any
unrestricted machine, and `.github/workflows/verify-live.yml` runs it on a 6-hour schedule, on every change to
`docs/data/series.json`, and on demand — from a runner that does have a route to Kalshi.

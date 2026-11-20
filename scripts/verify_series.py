#!/usr/bin/env python3
"""Re-verify every series row published in docs/data/series.json against the live Kalshi API.

Why this exists
---------------
The site publishes one table row per Kalshi *series*. Each row must be traceable to the exact
official API response that returned it, so this script re-fetches
`GET /series/{ticker}` for every row and compares the fields we publish.

Endpoints used (public, no auth):
  GET {base}/series/{ticker}          https://docs.kalshi.com/api-reference/market/get-series
  GET {base}/series?category=&tags=   https://docs.kalshi.com/api-reference/market/get-series-list

Usage:
  python scripts/verify_series.py                 # verify, print report
  python scripts/verify_series.py --json out.json # also write machine-readable report

Note: this script needs outbound HTTPS to the Kalshi host. In sandboxed CI the egress
allowlist may block it; --from-cache lets you verify against a saved snapshot instead.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data" / "series.json"
DEMO = "https://external-api.demo.kalshi.co/trade-api/v2"


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "trade3-verify/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def check_row(base: str, ticker: str, expect: dict, cache: dict | None) -> dict:
    """Compare one published row with the official series record."""
    url = f"{base}/series/{ticker}"
    result = {"ticker": ticker, "source": url, "ok": True, "diffs": [], "notes": []}
    try:
        rec = (cache or {}).get(ticker) or fetch_json(url)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        result["ok"] = False
        result["diffs"].append(f"fetch failed: {e!r}")
        return result
    if "series" in rec:
        rec = rec["series"]
    if not rec or "ticker" not in rec:
        result["ok"] = False
        result["diffs"].append("no series record returned")
        return result

    # Fields we publish, compared against the official record.
    for field, api_key in (("title", "title"), ("frequency", "frequency")):
        api_val = (rec.get(api_key) or "").strip()
        pub_val = (expect.get(field) or "").strip()
        if pub_val != api_val:
            result["ok"] = False
            result["diffs"].append(f"{field}: published {pub_val!r} != API {api_val!r}")

    # Settlement source: published as "NAME — URL"; must match the API's first source.
    sources = rec.get("settlement_sources") or []
    if sources:
        first = f"{sources[0].get('name','')} — {sources[0].get('url','')}".strip()
        if (expect.get("settlement") or "").strip() != first.strip():
            result["ok"] = False
            result["diffs"].append(
                f"settlement: published {expect.get('settlement')!r} != API {first!r}")
    else:
        if expect.get("settlement"):
            result["ok"] = False
            result["diffs"].append("settlement: API returns no settlement_sources, "
                                   "but a value is published (must be blank)")
        else:
            result["notes"].append("API returns no settlement_sources (published blank — correct)")

    # Category must be in the series' own categories list.
    if expect.get("category"):
        cats = rec.get("categories") or [rec.get("category")]
        if expect["category"] not in cats:
            result["ok"] = False
            result["diffs"].append(f"category: published {expect['category']!r} "
                                   f"not in API categories {cats!r}")
    result["api_category"] = rec.get("category")
    result["api_tags"] = rec.get("tags")
    result["api_frequency"] = rec.get("frequency")
    result["api_title"] = rec.get("title")
    result["api_settlement"] = sources[0] if sources else None
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEMO)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--from-cache", type=Path,
                    help="JSON file of {ticker: <series response>} (or {series_cache: {...}}) to verify offline")
    ap.add_argument("--only", help="comma-separated tickers to check (default: every published row)")
    ap.add_argument("--skip-uncached", action="store_true",
                    help="with --from-cache: report rows absent from the cache as NOT CHECKED instead of failing on fetch")
    args = ap.parse_args()

    data = json.loads(DATA.read_text())
    cache = json.loads(args.from_cache.read_text()) if args.from_cache else None
    if cache and "series_cache" in cache:          # evidence bundle written by the integration session
        cache = cache["series_cache"]
    only = {t.strip() for t in args.only.split(",")} if args.only else None

    rows = []
    skipped = []
    for topic_id, topic in data["topics"].items():
        for row in topic["series"]:
            if only and row["ticker"] not in only:
                continue
            if args.skip_uncached and cache is not None and row["ticker"] not in cache:
                skipped.append(row["ticker"])
                continue
            expect = dict(row, category=row.get("category") or topic["kalshi_category"])
            r = check_row(args.base, row["ticker"], expect, cache)
            r["topic"] = topic_id
            rows.append(r)

    bad = [r for r in rows if not r["ok"]]
    for r in rows:
        status = "OK  " if r["ok"] else "FAIL"
        print(f"{status} {r['ticker']:<22} {r['topic']:<10} {r.get('api_title','')}")
        for d in r["diffs"]:
            print(f"       ! {d}")
        for n in r["notes"]:
            print(f"       - {n}")
    if skipped:
        print(f"NOT CHECKED (absent from the cache): {len(skipped)} — {', '.join(skipped)}")
    print(f"\n{len(rows) - len(bad)}/{len(rows)} rows verified against {args.base}")
    if bad:
        print("Mismatches:", ", ".join(r["ticker"] for r in bad))
    if args.json:
        args.json.write_text(json.dumps({"base": args.base, "rows": rows}, indent=2))
        print(f"wrote {args.json}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

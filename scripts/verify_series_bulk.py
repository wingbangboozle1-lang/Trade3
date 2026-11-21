#!/usr/bin/env python3
"""Bulk, cache-friendly re-verification of every published series row.

Why this exists
---------------
`scripts/verify_series.py` is a one-shot checker: it fetches every row itself and fails
loudly when the network is unavailable. That is right for CI on a runner with egress,
but in this build sandbox the shell has **no route to the Kalshi hosts** (TLS reset,
recorded since session `63ad86b3`), so the only way to read the official API is the
agent's page-fetch path. This script bridges the gap without ever guessing:

  1. `--emit-requests` writes the exact official URL for every published row
     (`GET {base}/series/{ticker}`) to a manifest file. Nothing is invented: the URL
     shape is the documented "Get Series" endpoint
     (https://docs.kalshi.com/api-reference/market/get-series).
  2. A fetcher (agent page-fetch, curl on a CI runner, anything) stores each raw JSON
     response under `{ticker: <response>}` in a cache file.
  3. `--from-cache` compares every published field against that raw response using the
     *same* comparison rules as `verify_series.py` (title, frequency, category, and the
     settlement string against `settlement_sources[0]`, including the
     `official-publishers-only` policy from flag F10) and exits non-zero on any diff.

So a value is only ever marked verified when a raw official response says so. A row with
no cached response is reported as NOT CHECKED — never as passing.

Usage:
  python3 scripts/verify_series_bulk.py --emit-requests data/verify-manifest-YYYY-MM-DD.txt
  python3 scripts/verify_series_bulk.py --from-cache docs/data/series-recheck-YYYY-MM-DD.json
  python3 scripts/verify_series_bulk.py --from-cache cache.json --json report.json --topics gas,golf
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERIES_JSON = ROOT / "docs" / "data" / "series.json"
DEMO = "https://external-api.demo.kalshi.co/trade-api/v2"


def load_rows(topics: list[str] | None) -> list[dict]:
    data = json.loads(SERIES_JSON.read_text())
    rows: list[dict] = []
    for topic_id, topic in data["topics"].items():
        if topics and topic_id not in topics:
            continue
        for row in topic.get("series", []):
            rows.append({**row, "topic": topic_id})
    return rows


def unwrap(rec: dict) -> dict:
    """Accept either {"series": {...}} or the bare series record."""
    if isinstance(rec, dict) and isinstance(rec.get("series"), dict):
        return rec["series"]
    return rec or {}


def check_row(row: dict, cache: dict) -> dict:
    """Compare one published row against a RAW official response. Same rules as verify_series.py."""
    ticker = row["ticker"]
    out = {"ticker": ticker, "topic": row.get("topic"), "source": f"{DEMO}/series/{ticker}",
           "checked": False, "ok": False, "diffs": [], "notes": []}
    if ticker not in cache:
        out["notes"].append("no cached official response for this ticker — NOT CHECKED (never assumed)")
        return out
    rec = unwrap(cache[ticker])
    if not rec.get("ticker"):
        out["diffs"].append("cached response is not a series record")
        return out
    out["checked"] = True
    out["ok"] = True

    # title + frequency must match exactly (whitespace-normalised, as published).
    for field in ("title", "frequency"):
        api_val = str(rec.get(field) or "").strip()
        pub_val = str(row.get(field) or "").strip()
        if pub_val != api_val:
            out["ok"] = False
            out["diffs"].append(f"{field}: published {pub_val!r} != API {api_val!r}")

    # category must be one of the series' own categories.
    if row.get("category"):
        cats = rec.get("categories") or [rec.get("category")]
        if row["category"] not in cats:
            out["ok"] = False
            out["diffs"].append(f"category: published {row['category']!r} not in API {cats!r}")

    # settlement string: "NAME — URL", must equal settlement_sources[0] verbatim.
    sources = rec.get("settlement_sources") or []
    policy = row.get("settlement_policy")
    published = str(row.get("settlement") or "").strip()
    if sources:
        first = f"{sources[0].get('name', '')} — {sources[0].get('url', '')}".strip()
        if policy == "official-publishers-only":
            if published:
                if published not in [f"{s.get('name', '')} — {s.get('url', '')}".strip() for s in sources]:
                    out["ok"] = False
                    out["diffs"].append("settlement: published value is not one of the API settlement_sources")
                else:
                    out["notes"].append("settlement deliberately blanked/pruned under official-publishers-only (F10)")
            else:
                out["notes"].append("settlement blank on purpose under official-publishers-only (F10)")
        elif published != first:
            out["ok"] = False
            out["diffs"].append(f"settlement: published {published!r} != API {first!r}")
    else:
        if published:
            out["ok"] = False
            out["diffs"].append("settlement: API returns no settlement_sources but a value is published")
        else:
            out["notes"].append("API returns no settlement_sources (published blank — correct)")

    out["api"] = {"title": rec.get("title"), "category": rec.get("category"),
                  "frequency": rec.get("frequency"), "tags": rec.get("tags")}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit-requests", type=Path, help="write the official URL for every row, one per line")
    ap.add_argument("--from-cache", type=Path, help="JSON of {ticker: <raw series response>}")
    ap.add_argument("--json", type=Path, help="write the machine-readable report here")
    ap.add_argument("--topics", help="comma-separated topic ids to restrict to (default: all)")
    ap.add_argument("--base", default=DEMO)
    args = ap.parse_args()
    topics = [t.strip() for t in args.topics.split(",")] if args.topics else None
    rows = load_rows(topics)

    if args.emit_requests:
        lines = [f"{args.base}/series/{r['ticker']}" for r in rows]
        args.emit_requests.parent.mkdir(parents=True, exist_ok=True)
        args.emit_requests.write_text("\n".join(lines) + "\n")
        print(f"wrote {len(lines)} request URLs to {args.emit_requests}")
        return 0

    if not args.from_cache:
        ap.error("one of --emit-requests or --from-cache is required")

    cache = json.loads(args.from_cache.read_text())
    cache = cache.get("series_cache", cache) if isinstance(cache, dict) else {}
    results = [check_row(r, cache) for r in rows]
    checked = [r for r in results if r["checked"]]
    failed = [r for r in checked if not r["ok"]]
    unchecked = [r for r in results if not r["checked"]]

    for r in results:
        mark = "PASS" if r["ok"] else ("FAIL" if r["checked"] else "----")
        detail = "; ".join(r["diffs"] + r["notes"])
        print(f"{mark} {r['ticker']:<28} {detail}")
    print(f"\n{len(checked)}/{len(results)} rows checked against raw official responses · "
          f"{len(failed)} mismatch(es) · {len(unchecked)} not checked")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps({"checked": len(checked), "total": len(results),
                                         "mismatches": len(failed), "rows": results}, indent=1))
        print(f"report: {args.json}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Run a paper-trading simulation against the Kalshi demo environment.

What it does, per poll:
  1. GET /events?status=open and GET /markets?status=open  (public, no key)
  2. keep only the five topics, classified by event category + series map
  3. detect >= $0.10 swings against the previous poll, apply the high-ROI screen
  4. open paper trades for each strategy, mark open positions
  5. after the last poll, settle against GET /markets?status=settled `result`

Writes sim_output.json plus a per-trade CSV. No orders are placed: real demo
execution lives behind kalshi_client.place_order(dry_run=False) and requires
KALSHI_ALLOW_ORDERS=1 with your own demo key.

Usage:
  python run_sim.py --polls 6 --interval 20
  python run_sim.py --base prod --polls 3 --interval 15 --contracts 5
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from backtest import PaperPortfolio, run_backtest, screen_summary
from kalshi_client import (DEMO_BASE, DEMO_BASE_ALT, PROD_BASE, PROD_BASE_ALT,
                           TOPIC_FILTERS, KalshiClient, KalshiError, build_topic_series,
                           classify, dollar_volume, last_price)
from strategies import ALERT_THRESHOLD, STRATEGIES, STRATEGY_RULES, drift, is_high_roi


def build_client(base: str) -> KalshiClient:
    if base == "prod":
        return KalshiClient(base_url=PROD_BASE)
    return KalshiClient(base_url=DEMO_BASE)


def fetch_scope(client: KalshiClient, topic_series: dict[str, set[str]]) -> list[dict]:
    """Open contracts restricted to the five topics."""
    events = client.open_events(max_pages=3)
    markets = client.open_markets(max_pages=4)
    return classify(markets, events, topic_series)


def settle_rows(client: KalshiClient, series: list[str], per_series: int = 20) -> list[dict]:
    out: list[dict] = []
    for ticker in series[:20]:
        try:
            page = client.markets(series_ticker=ticker, status="settled", limit=per_series,
                                  mve_filter=None)
            out.extend(page.get("markets", []))
        except KalshiError:
            continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", choices=["demo", "prod"], default="demo")
    ap.add_argument("--polls", type=int, default=6)
    ap.add_argument("--interval", type=int, default=20)
    ap.add_argument("--contracts", type=int, default=10)
    ap.add_argument("--cash", type=float, default=1000.0)
    ap.add_argument("--out", default="sim_output.json")
    ap.add_argument("--csv", default="sim_trades.csv")
    args = ap.parse_args()

    client = build_client(args.base)
    try:
        status = client.exchange_status()
    except Exception as exc:                                  # noqa: BLE001 - surface, don't crash
        print(f"cannot reach {client.base_url}: {exc}")
        print(f"documented alternate host: {DEMO_BASE_ALT if args.base == 'demo' else PROD_BASE_ALT}")
        return 2
    print(f"exchange: {json.dumps(status)}")
    print(f"base: {client.base_url}")

    topic_series = build_topic_series(client)
    print("series discovered per topic: " + ", ".join(f"{k}={len(v)}" for k, v in topic_series.items()))

    snapshots: list[dict] = []
    alerts: list[dict] = []
    prev: dict[str, float] = {}
    last_markets: dict[str, dict] = {}

    for poll in range(args.polls):
        ts = int(time.time())
        try:
            markets = fetch_scope(client, topic_series)
        except Exception as exc:                              # noqa: BLE001
            print(f"poll {poll}: fetch failed: {exc}")
            markets = []

        moves: dict[str, float] = {}
        for m in markets:
            px = last_price(m)
            if px is None:
                continue
            old = prev.get(m["ticker"])
            if old is not None:
                delta = px - old
                moves[m["ticker"]] = delta
                if abs(delta) >= ALERT_THRESHOLD - 1e-9:
                    ok, reasons = is_high_roi(m, delta)
                    alerts.append({
                        "ts": ts, "ticker": m["ticker"], "topic": m.get("_topic"),
                        "event": m.get("event_ticker"), "from": round(old, 4),
                        "to": round(px, 4), "delta": round(delta, 4),
                        "high_roi": ok, "filtered_by": reasons,
                        "dollar_volume": round(dollar_volume(m), 2),
                    })
            prev[m["ticker"]] = px
            last_markets[m["ticker"]] = m

        snapshots.append({"ts": ts, "markets": markets})
        by_topic: dict[str, int] = {}
        for m in markets:
            by_topic[m.get("_topic", "-")] = by_topic.get(m.get("_topic", "-"), 0) + 1
        screen = screen_summary(markets, moves)
        print(f"poll {poll}: {len(markets)} contracts {by_topic} · "
              f"{len(alerts)} alerts so far · screen pass {screen['passed']}/{screen['checked']}")
        if poll < args.polls - 1:
            time.sleep(args.interval)

    series = sorted({m.get("_series") for m in last_markets.values() if m.get("_series")})
    settled = settle_rows(client, series)
    print(f"settled records fetched: {len(settled)} across {len(series)} series")

    results: dict = {}
    portfolios: dict[str, PaperPortfolio] = {}
    for name in STRATEGIES:
        pf = run_backtest(snapshots, strategy=name, contracts=args.contracts,
                          starting_cash=args.cash, settled_markets=settled)
        portfolios[name] = pf
        results[name] = pf.summary()

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base": client.base_url,
        "topics": list(TOPIC_FILTERS),
        "polls": args.polls,
        "interval_seconds": args.interval,
        "contracts_per_trade": args.contracts,
        "alert_threshold": ALERT_THRESHOLD,
        "alerts": alerts,
        "alerts_high_roi": [a for a in alerts if a["high_roi"]],
        "strategy_rules": STRATEGY_RULES,
        "results": results,
        "contracts_seen": len(last_markets),
        "settled_records": len(settled),
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))

    # one CSV per strategy keeps the blotter readable
    for name, pf in portfolios.items():
        pf.write_csv(Path(args.csv).with_name(f"{Path(args.csv).stem}-{name}.csv"))

    for name, summary in results.items():
        print(f"\n{name}: {json.dumps(summary, indent=2)}")
    print(f"\nwrote {args.out} and {Path(args.csv).stem}-*.csv "
          f"({len(alerts)} alerts, {sum(s['settled_trades'] for s in results.values())} settled trades)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Run a live paper-trading simulation against Kalshi demo (no keys needed).

Polls public market data for the five topics, emits >= $0.10 swing alerts,
applies the high-ROI filter, and paper-trades each strategy. Writes
`sim_output.json` (portfolio summary + alerts + trades).

Usage:
    python run_sim.py [--base demo|prod] [--polls 12] [--interval 30]
                      [--strategy momentum|mean_reversion|favorite_longshot]

Live demo *execution* (real demo orders) requires KALSHI_API_KEY_ID +
KALSHI_PRIVATE_KEY_PATH; this script never places orders.
"""
from __future__ import annotations

import argparse
import json
import time

from backtest import PaperPortfolio, median_dollar_vol
from kalshi_client import DEMO_BASE, PROD_BASE, KalshiClient, dollar_volume, fetch_topic_markets
from strategies import STRATEGIES, is_high_roi, last_price

TOPICS = ["gas", "elections", "culture", "crypto", "golf"]

# Threshold comparison in integer 1/10000-dollar space: floating-point subtraction can
# turn an exactly-$0.10 move into 0.09999..., which would silently drop the alert.
def _moved_at_least_dime(old: float, new: float) -> bool:
    return abs(round(new * 10000) - round(old * 10000)) >= 1000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", choices=["demo", "prod"], default="demo")
    ap.add_argument("--polls", type=int, default=6)
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--strategy", default="momentum", choices=list(STRATEGIES))
    args = ap.parse_args()

    client = KalshiClient(base_url=DEMO_BASE if args.base == "demo" else PROD_BASE)
    print("exchange:", client.exchange_status())
    pf = PaperPortfolio()
    prev: dict = {}
    alerts: list = []
    entered: set = set()
    for poll in range(args.polls):
        ts = int(time.time())
        all_markets: list = []
        for topic in TOPICS:
            try:
                ms = fetch_topic_markets(client, topic)
            except Exception as e:  # keep sim alive; surface the error
                print(f"[{topic}] fetch failed: {e}")
                continue
            all_markets.extend(ms)
            print(f"poll {poll} [{topic}] {len(ms)} open markets; top: "
                  f"{ms[0]['ticker'] if ms else '-'} ${dollar_volume(ms[0]):,.0f}" if ms else f"poll {poll} [{topic}] none")
        med = median_dollar_vol(all_markets)
        for m in all_markets:
            p = last_price(m)
            old = prev.get(m["ticker"])
            if old is not None and _moved_at_least_dime(old, p):
                alert = {"ts": ts, "ticker": m["ticker"], "topic": m.get("_topic"),
                         "from": old, "to": p, "delta": round(p - old, 4),
                         "high_roi": is_high_roi(m, old, med)}
                alerts.append(alert)
                print("ALERT", alert)
            if m["ticker"] not in entered:
                side = STRATEGIES[args.strategy](m, old)
                if side and pf.open_position(m, args.strategy, side, 10, ts):
                    entered.add(m["ticker"])
            prev[m["ticker"]] = p
        if poll < args.polls - 1:
            time.sleep(args.interval)
    out = {"base": args.base, "strategy": args.strategy, "alerts": alerts,
           "portfolio": pf.summary(),
           "trades": [t.__dict__ for t in pf.trades]}
    with open("sim_output.json", "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out["portfolio"], indent=2))
    print(f"wrote sim_output.json ({len(alerts)} alerts, {len(pf.trades)} paper trades)")


if __name__ == "__main__":
    main()

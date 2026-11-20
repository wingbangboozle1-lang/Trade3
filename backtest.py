"""Paper-trading backtest + portfolio accounting.

Simulates fills at the quoted ask (buy) and settles at $1.00 (yes) / $0.00
(no) using the market's `result` field once resolved. No real orders are
placed here. For live demo execution, use KalshiClient.place_order with
your own demo keys (see README).

Trade record fields: ticker, topic, strategy, side, entry_price,
contracts, entry_ts, exit_price, pnl, roi, result, category.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from kalshi_client import dollar_volume
from strategies import STRATEGIES, is_high_roi, last_price


@dataclass
class PaperTrade:
    ticker: str
    topic: str
    strategy: str
    side: str
    entry_price: float
    contracts: int
    entry_ts: int
    exit_price: float | None = None
    pnl: float | None = None
    roi: float | None = None
    result: str = ""          # "yes" | "no" | "" (unresolved)
    title: str = ""


@dataclass
class PaperPortfolio:
    cash: float = 1000.0
    trades: list = field(default_factory=list)

    def open_position(self, m: dict, strategy: str, side: str, contracts: int, ts: int) -> PaperTrade | None:
        ask = m.get("yes_ask_dollars")
        bid = m.get("yes_bid_dollars")
        px = float(ask) if side == "yes" and ask not in (None, "") else float(bid or 0)
        if px <= 0:
            px = last_price(m)
        cost = px * contracts
        if cost > self.cash or cost <= 0:
            return None
        self.cash -= cost
        t = PaperTrade(ticker=m["ticker"], topic=m.get("_topic", ""), strategy=strategy,
                       side=side, entry_price=px, contracts=contracts, entry_ts=ts,
                       title=m.get("title", ""))
        self.trades.append(t)
        return t

    def settle(self, market: dict) -> None:
        """Settle open trades for a resolved market (result yes/no)."""
        result = (market.get("result") or "").lower()
        if result not in ("yes", "no"):
            return
        payout = 1.0 if result == "yes" else 0.0
        for t in self.trades:
            if t.ticker == market["ticker"] and t.exit_price is None:
                t.result = result
                t.exit_price = payout if t.side == "yes" else (1.0 - payout)
                proceeds = t.exit_price * t.contracts
                self.cash += proceeds
                cost = t.entry_price * t.contracts
                t.pnl = proceeds - cost
                t.roi = (t.pnl / cost) if cost else 0.0

    def summary(self) -> dict:
        done = [t for t in self.trades if t.pnl is not None]
        by_strategy: dict = {}
        by_topic: dict = {}
        for t in done:
            for bucket, key in ((by_strategy, t.strategy), (by_topic, t.topic)):
                b = bucket.setdefault(key, {"trades": 0, "wins": 0, "pnl": 0.0})
                b["trades"] += 1
                b["wins"] += 1 if t.pnl > 0 else 0
                b["pnl"] += t.pnl
        return {
            "cash": round(self.cash, 2),
            "open_trades": len(self.trades) - len(done),
            "settled_trades": len(done),
            "total_pnl": round(sum(t.pnl for t in done), 2),
            "win_rate": round(sum(1 for t in done if t.pnl > 0) / len(done), 4) if done else None,
            "by_strategy": by_strategy,
            "by_topic": by_topic,
        }


def run_backtest(snapshots: list, strategy: str = "momentum", contracts: int = 10,
                 starting_cash: float = 1000.0) -> PaperPortfolio:
    """Replay price snapshots [{ts, markets:[...]}] through one strategy.

    Entry rule: first snapshot where the strategy fires for a ticker.
    Settlement uses each market's final `result` if present, else the
    last observed price as a mark (flagged as unresolved in output).
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy: {strategy}")
    fn = STRATEGIES[strategy]
    pf = PaperPortfolio(cash=starting_cash)
    prev: dict = {}
    entered: set = set()
    last_seen: dict = {}
    for snap in snapshots:
        for m in snap["markets"]:
            last_seen[m["ticker"]] = m
            if m["ticker"] in entered:
                continue
            side = fn(m, prev.get(m["ticker"]))
            if side:
                if pf.open_position(m, strategy, side, contracts, snap["ts"]):
                    entered.add(m["ticker"])
            prev[m["ticker"]] = last_price(m)
    for m in last_seen.values():
        pf.settle(m)
    # Mark unresolved trades at last price (do not count as realized PnL).
    for t in pf.trades:
        if t.exit_price is None:
            t.result = "unresolved"
    return pf


def median_dollar_vol(markets: list) -> float:
    vals = [dollar_volume(m) for m in markets]
    return statistics.median(vals) if vals else 0.0

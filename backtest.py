"""Paper-trading backtest and portfolio accounting.

Fill model, stated plainly so results can be reproduced:
  * buy at the quoted ask (YES ask, or 1 - YES bid for NO)
  * mark open positions at the last trade price
  * settle at $1.00 / $0.00 from Kalshi's own `result` field
  * no fees and no slippage beyond the quoted book

A trade only becomes "settled" when the exchange publishes result=yes|no.
Anything else stays unrealised, which is reported separately.
"""
from __future__ import annotations

import csv
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from strategies import STRATEGIES, is_high_roi, last_price, spread

DEFAULT_STARTING_CASH = 1000.0


def _f(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def entry_price(market: dict, side: str) -> float | None:
    """Price actually paid: YES ask for a YES buy, 1 - YES bid for a NO buy."""
    ask = _f(market.get("yes_ask_dollars"))
    bid = _f(market.get("yes_bid_dollars"))
    if side == "yes":
        if ask is not None and 0 < ask < 1:
            return ask
        px = last_price(market)
        return px if px is not None and 0 < px < 1 else None
    if bid is not None:
        return 1.0 - bid
    px = last_price(market)
    return None if px is None else 1.0 - px


@dataclass
class PaperTrade:
    ticker: str
    topic: str
    strategy: str
    side: str
    entry: float
    contracts: int
    entry_ts: int
    series: str = ""
    title: str = ""
    result: str = ""
    exit: float | None = None
    pnl: float | None = None
    roi: float | None = None
    mark: float | None = None
    unrealised: float | None = None

    def as_row(self) -> dict:
        return {
            "ticker": self.ticker, "topic": self.topic, "strategy": self.strategy,
            "side": self.side, "entry": round(self.entry, 4), "contracts": self.contracts,
            "entry_ts": self.entry_ts, "series": self.series, "title": self.title,
            "settled": self.exit is not None, "result": self.result,
            "exit": None if self.exit is None else round(self.exit, 4),
            "pnl": None if self.pnl is None else round(self.pnl, 2),
            "roi": None if self.roi is None else round(self.roi, 4),
            "mark": self.mark, "unrealised": self.unrealised,
        }


@dataclass
class PaperPortfolio:
    cash: float = DEFAULT_STARTING_CASH
    starting_cash: float = DEFAULT_STARTING_CASH
    trades: list = field(default_factory=list)

    def open(self, market: dict, strategy: str, side: str, contracts: int, ts: int) -> PaperTrade | None:
        px = entry_price(market, side)
        if px is None or px <= 0 or px >= 1:
            return None
        cost = px * contracts
        if cost > self.cash:
            return None
        self.cash -= cost
        trade = PaperTrade(
            ticker=market["ticker"], topic=market.get("_topic", ""), strategy=strategy,
            side=side, entry=px, contracts=contracts, entry_ts=ts,
            series=market.get("_series", ""), title=market.get("title", ""),
        )
        self.trades.append(trade)
        return trade

    def mark(self, market: dict) -> None:
        """Mark open trades at the last trade price (never counted as profit)."""
        px = last_price(market)
        if px is None:
            return
        for t in self.trades:
            if t.exit is None and t.ticker == market["ticker"]:
                t.mark = px
                side_px = px if t.side == "yes" else 1.0 - px
                t.unrealised = (side_px - t.entry) * t.contracts

    def settle(self, market: dict) -> None:
        result = (market.get("result") or "").lower()
        if result not in ("yes", "no"):
            return
        payout = 1.0 if result == "yes" else 0.0
        for t in self.trades:
            if t.ticker == market["ticker"] and t.exit is None:
                t.result = result
                t.exit = payout if t.side == "yes" else 1.0 - payout
                proceeds = t.exit * t.contracts
                self.cash += proceeds
                cost = t.entry * t.contracts
                t.pnl = proceeds - cost
                t.roi = (t.pnl / cost) if cost else 0.0
                t.unrealised = None

    # -- reporting ---------------------------------------------------------
    def summary(self) -> dict:
        settled = [t for t in self.trades if t.exit is not None]
        open_trades = [t for t in self.trades if t.exit is None]
        pnl = sum(t.pnl or 0.0 for t in settled)
        stake = sum(t.entry * t.contracts for t in settled)
        unrealised = sum(t.unrealised or 0.0 for t in open_trades)

        def bucket(key):
            out: dict = {}
            for t in settled:
                b = out.setdefault(getattr(t, key) or "-", {"trades": 0, "wins": 0, "pnl": 0.0})
                b["trades"] += 1
                b["wins"] += 1 if (t.pnl or 0) > 0 else 0
                b["pnl"] = round(b["pnl"] + (t.pnl or 0.0), 2)
            return out

        return {
            "starting_cash": round(self.starting_cash, 2),
            "cash": round(self.cash, 2),
            "open_trades": len(open_trades),
            "settled_trades": len(settled),
            "realised_pnl": round(pnl, 2),
            "unrealised_pnl": round(unrealised, 2),
            "roi_on_stake": round(pnl / stake, 4) if stake else None,
            "win_rate": round(sum(1 for t in settled if (t.pnl or 0) > 0) / len(settled), 4) if settled else None,
            "by_topic": bucket("topic"),
            "by_strategy": bucket("strategy"),
        }

    def write_csv(self, path: str | Path) -> Path:
        path = Path(path)
        rows = [t.as_row() for t in self.trades]
        fields = list(PaperTrade("", "", "", "", 0.0, 0, 0).as_row().keys())
        with path.open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        return path


def median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def run_backtest(snapshots: list[dict], strategy: str = "momentum",
                 contracts: int = 10, starting_cash: float = DEFAULT_STARTING_CASH,
                 settled_markets: list[dict] | None = None) -> PaperPortfolio:
    """Replay snapshots [{ts, markets: [...]}] through one strategy.

    Entry: the first snapshot in which the strategy fires for a ticker.
    Settlement: `settled_markets` (from GET /markets?status=settled), because a
    snapshot of open markets does not carry a result.
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy: {strategy}")
    rule = STRATEGIES[strategy]
    portfolio = PaperPortfolio(cash=starting_cash, starting_cash=starting_cash)
    entered: set[str] = set()
    last_seen: dict[str, dict] = {}

    for snap in snapshots:
        ts = snap["ts"]
        for market in snap["markets"]:
            last_seen[market["ticker"]] = market
            if market["ticker"] in entered:
                portfolio.mark(market)
                continue
            side = rule(market)
            if side and portfolio.open(market, strategy, side, contracts, ts):
                entered.add(market["ticker"])

    for market in last_seen.values():
        portfolio.mark(market)
    for market in (settled_markets or []):
        portfolio.settle(market)
    return portfolio


def screen_summary(markets: list[dict], moves: dict[str, float] | None = None) -> dict:
    """How many live contracts pass the high-ROI screen, and why the rest fail."""
    moves = moves or {}
    passed, failed = 0, {}
    for m in markets:
        ok, reasons = is_high_roi(m, moves.get(m["ticker"]))
        if ok:
            passed += 1
        for reason in reasons:
            key = reason.split(" < ")[0].split(" outside")[0]
            failed[key] = failed.get(key, 0) + 1
    return {"checked": len(markets), "passed": passed, "failed_by_rule": failed,
            "median_spread": median([s for s in (spread(m) for m in markets) if s is not None])}

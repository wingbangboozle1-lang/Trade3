"""Trading strategies + high-ROI filter (transparent heuristics).

These are *research heuristics*, not financial advice and not a prediction
model. Every rule is explicit so results can be reproduced and audited.

Strategies (each returns side in {"yes", "no", None} given a snapshot):
- momentum: follow a >= $0.10 move in the same direction.
- mean_reversion: fade an extreme price (<=0.15 or >=0.85) toward 0.50.
- favorite_longshot: buy the favorite (price >= 0.65) for small edge.
- volume_breakout: trade with volume in the top quartile for that topic.

High-ROI filter (for the selective alert chat): price in [0.15, 0.85],
dollar volume above the topic median, spread <= $0.10 when quotes exist,
and |recent move| >= $0.05. All thresholds are constants below.
"""
from __future__ import annotations

ALERT_THRESHOLD = 0.10  # $ swing that triggers an alert (either direction)
ROI_MIN_PRICE = 0.15
ROI_MAX_PRICE = 0.85
ROI_MIN_MOVE = 0.05
ROI_MAX_SPREAD = 0.10


def _f(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def last_price(m: dict) -> float:
    return _f(m.get("last_price_dollars"), _f(m.get("yes_bid_dollars")))


def spread(m: dict) -> float | None:
    bid, ask = _f(m.get("yes_bid_dollars"), None), _f(m.get("yes_ask_dollars"), None)
    if bid is None or ask is None:
        return None
    return ask - bid


def momentum(m: dict, prev_price: float | None) -> str | None:
    if prev_price is None:
        return None
    d = last_price(m) - prev_price
    if d >= ALERT_THRESHOLD:
        return "yes"
    if d <= -ALERT_THRESHOLD:
        return "no"
    return None


def mean_reversion(m: dict) -> str | None:
    p = last_price(m)
    if p <= 0.15:
        return "yes"   # cheap yes, fade down
    if p >= 0.85:
        return "no"    # expensive yes, fade up
    return None


def favorite_longshot(m: dict) -> str | None:
    p = last_price(m)
    if p >= 0.65:
        return "yes"
    if p <= 0.35:
        return "no"
    return None


def volume_breakout(m: dict, volume_cutoff: float) -> str | None:
    from kalshi_client import dollar_volume

    if dollar_volume(m) < volume_cutoff:
        return None
    p = last_price(m)
    return "yes" if p >= 0.50 else "no"


def is_high_roi(m: dict, prev_price: float | None, median_dollar_vol: float) -> bool:
    from kalshi_client import dollar_volume

    p = last_price(m)
    if not (ROI_MIN_PRICE <= p <= ROI_MAX_PRICE):
        return False
    if dollar_volume(m) < median_dollar_vol:
        return False
    s = spread(m)
    if s is not None and s > ROI_MAX_SPREAD:
        return False
    if prev_price is not None and abs(p - prev_price) < ROI_MIN_MOVE:
        return False
    return True


STRATEGIES = {
    "momentum": momentum,
    "mean_reversion": lambda m, prev=None: mean_reversion(m),
    "favorite_longshot": lambda m, prev=None: favorite_longshot(m),
}

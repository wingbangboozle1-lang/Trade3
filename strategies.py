"""Trading strategies (research rules, published in full) + the high-ROI screen.

These are *rules you can read*, not a prediction model. Every threshold is a
module constant so a result can be reproduced exactly.

Rules
-----
momentum        follow a move: buy YES after a >= $0.10 rise, NO after a fall.
mean_reversion  fade extremes: buy YES at <= $0.15, NO at >= $0.85.
favorite        buy the favourite when priced >= $0.65.
longshot_value  buy cheap YES at <= $0.35 (many small losses, occasional big win).

High-ROI screen (used by the second alert stream)
-------------------------------------------------
price in [0.15, 0.85], |move| >= $0.05, spread <= $0.10,
dollar volume >= $250, depth within 3c of best bid >= 50 contracts.
"""
from __future__ import annotations

ALERT_THRESHOLD = 0.10   # a swing this large raises an alert (either direction)

ROI_MIN_PRICE = 0.15
ROI_MAX_PRICE = 0.85
ROI_MIN_MOVE = 0.05
ROI_MAX_SPREAD = 0.10
ROI_MIN_DOLLAR_VOL = 250.0
ROI_MIN_DEPTH = 50.0

FAVORITE_MIN = 0.65
LONGSHOT_MAX = 0.35
REVERSION_LOW = 0.15
REVERSION_HIGH = 0.85


def _f(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def last_price(market: dict) -> float | None:
    price = _f(market.get("last_price_dollars"))
    if price is not None:
        return price
    return _f(market.get("yes_bid_dollars"))


def drift(market: dict) -> float | None:
    """Change since the previous print. Kalshi publishes previous_price_dollars,
    so the baseline is a documented field rather than something we invent."""
    now = last_price(market)
    prev = _f(market.get("previous_price_dollars"))
    if now is None or prev is None or prev <= 0:
        return None
    return now - prev


def spread(market: dict) -> float | None:
    bid = _f(market.get("yes_bid_dollars"))
    ask = _f(market.get("yes_ask_dollars"))
    if bid is None or ask is None:
        return None
    return ask - bid


def dollar_volume(market: dict) -> float:
    return (_f(market.get("volume_fp"), 0.0) or 0.0) * (last_price(market) or 0.0)


# --- strategies: (market) -> "yes" | "no" | None -----------------------------
def momentum(market: dict) -> str | None:
    d = drift(market)
    if d is None:
        return None
    if d >= ALERT_THRESHOLD:
        return "yes"
    if d <= -ALERT_THRESHOLD:
        return "no"
    return None


def mean_reversion(market: dict) -> str | None:
    p = last_price(market)
    if p is None:
        return None
    if p <= REVERSION_LOW:
        return "yes"
    if p >= REVERSION_HIGH:
        return "no"
    return None


def favorite(market: dict) -> str | None:
    p = last_price(market)
    return "yes" if p is not None and p >= FAVORITE_MIN else None


def longshot_value(market: dict) -> str | None:
    p = last_price(market)
    return "yes" if p is not None and p <= LONGSHOT_MAX else None


STRATEGIES = {
    "momentum": momentum,
    "mean_reversion": mean_reversion,
    "favorite": favorite,
    "longshot_value": longshot_value,
}

STRATEGY_RULES = {
    "momentum": "Follow a >= $0.10 move: buy YES after a rise, NO after a fall.",
    "mean_reversion": "Fade extremes: buy YES at <= $0.15, NO at >= $0.85.",
    "favorite": "Buy the favourite when priced >= $0.65.",
    "longshot_value": "Buy cheap YES at <= $0.35.",
}


def is_high_roi(market: dict, move_delta: float | None = None,
                depth: float | None = None) -> tuple[bool, list[str]]:
    """Apply the published screen. Returns (pass, reasons it failed)."""
    reasons: list[str] = []
    price = last_price(market)
    if price is None:
        reasons.append("no price")
    elif not (ROI_MIN_PRICE <= price <= ROI_MAX_PRICE):
        reasons.append(f"price outside {ROI_MIN_PRICE:.2f}-{ROI_MAX_PRICE:.2f}")
    if move_delta is None or abs(move_delta) < ROI_MIN_MOVE:
        reasons.append(f"move < ${ROI_MIN_MOVE:.2f}")
    s = spread(market)
    if s is not None and s > ROI_MAX_SPREAD:
        reasons.append(f"spread > ${ROI_MAX_SPREAD:.2f}")
    if dollar_volume(market) < ROI_MIN_DOLLAR_VOL:
        reasons.append(f"$ volume < ${ROI_MIN_DOLLAR_VOL:.0f}")
    if depth is not None and depth < ROI_MIN_DEPTH:
        reasons.append(f"depth < {ROI_MIN_DEPTH:.0f} contracts")
    return (not reasons, reasons)

"""Kalshi Trade API v2 client (demo + production) — fixed-point era.

Market data endpoints are public and need no key. Portfolio and order endpoints
need an API key plus an RSA-PSS or Ed25519 private key.

Everything here follows the official documentation, checked 2026-11-20:
  endpoints      https://docs.kalshi.com/getting_started/api_environments
  market data    https://docs.kalshi.com/getting_started/quick_start_market_data
  auth signing   https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
  order body     https://docs.kalshi.com/getting_started/quick_start_create_order
  positions      https://docs.kalshi.com/api-reference/portfolio/get-positions
  balance        https://docs.kalshi.com/api-reference/portfolio/get-balance
  rate limits    https://docs.kalshi.com/getting_started/rate_limits
  demo env       https://docs.kalshi.com/getting_started/demo_env

Keys never live in this repo. Load them from the environment:
    KALSHI_API_KEY_ID        the key id shown in the dashboard
    KALSHI_PRIVATE_KEY_PATH  path to your PEM private key
Optionally KALSHI_BASE_URL to point at production.

Nothing in this module runs on its own; run_sim.py drives it in dry-run mode
unless KALSHI_ALLOW_ORDERS=1 is set explicitly.
"""
from __future__ import annotations

import base64
import os
import time
import uuid
from urllib.parse import urlparse

import requests

DEMO_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
DEMO_BASE_ALT = "https://demo-api.kalshi.co/trade-api/v2"          # "also supported" per docs
PROD_BASE = "https://external-api.kalshi.com/trade-api/v2"
PROD_BASE_ALT = "https://api.elections.kalshi.com/trade-api/v2"    # "also supported" per docs
DEMO_WS = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2"
PROD_WS = "wss://external-api-ws.kalshi.com/trade-api/ws/v2"

# Topic -> (category, tags). Tags are the API's own spelling; matching normalises
# "&" to "and" so "Oil & Gas" and "Oil and energy" both resolve.
TOPIC_FILTERS = {
    "gas": {"category": "Economics", "tags": ["Oil & Gas", "Oil and energy"]},
    "elections": {"category": "Elections", "tags": []},
    "culture": {"category": "Entertainment", "tags": []},   # Kalshi has no "Culture" category (flag F1)
    "crypto": {"category": "Crypto", "tags": []},
    "golf": {"category": "Sports", "tags": ["Golf"]},
}

TOPICS = list(TOPIC_FILTERS)


def normalise_tag(tag: str) -> str:
    """'Oil & Gas' -> 'oil and gas'; matches how the API spells the same tag twice."""
    out = (tag or "").lower().replace("&", "and")
    return " ".join("".join(c if c.isalnum() else " " for c in out).split())


def _sign(private_key, timestamp: str, method: str, path: str) -> str:
    """Sign `timestamp + METHOD + path`; path keeps /trade-api/v2 and drops the query."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    message = f"{timestamp}{method.upper()}{path.split('?')[0]}".encode("utf-8")
    if isinstance(private_key, Ed25519PrivateKey):
        signature = private_key.sign(message)
    else:
        signature = private_key.sign(
            message,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )
    return base64.b64encode(signature).decode("utf-8")


class KalshiError(RuntimeError):
    """Raised for a documented API error, carrying the status and error code."""

    def __init__(self, status: int, payload) -> None:
        self.status = status
        self.payload = payload
        code = ""
        if isinstance(payload, dict):
            code = (payload.get("error") or {}).get("code") or payload.get("code") or ""
        super().__init__(f"HTTP {status}{(' ' + code) if code else ''}: {payload}")


class KalshiClient:
    def __init__(self, base_url: str = DEMO_BASE, api_key_id: str | None = None,
                 private_key_path: str | None = None, timeout: float = 15.0,
                 min_interval: float = 0.15):
        self.base_url = base_url.rstrip("/")
        self.api_key_id = api_key_id or os.environ.get("KALSHI_API_KEY_ID", "")
        self.timeout = timeout
        self.min_interval = min_interval
        self._last_call = 0.0
        self.session = requests.Session()
        self._private_key = None
        key_path = private_key_path or os.environ.get("KALSHI_PRIVATE_KEY_PATH", "")
        if key_path:
            from cryptography.hazmat.primitives import serialization

            with open(key_path, "rb") as fh:
                self._private_key = serialization.load_pem_private_key(fh.read(), password=None)

    # -- plumbing ----------------------------------------------------------
    def _throttle(self) -> None:
        gap = self.min_interval - (time.time() - self._last_call)
        if gap > 0:
            time.sleep(gap)
        self._last_call = time.time()

    def _headers(self, method: str, path: str) -> dict:
        headers = {"Accept": "application/json"}
        if not self.api_key_id or self._private_key is None:
            return headers
        ts = str(int(time.time() * 1000))
        sign_path = urlparse(self.base_url + path).path
        headers.update({
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": _sign(self._private_key, ts, method, sign_path),
        })
        return headers

    def _request(self, method: str, path: str, params: dict | None = None,
                 body: dict | None = None, retries: int = 2):
        last = None
        for attempt in range(retries + 1):
            self._throttle()
            headers = self._headers(method, path)
            if body is not None:
                headers["Content-Type"] = "application/json"
            resp = self.session.request(method, self.base_url + path, params=params or {},
                                        json=body, headers=headers, timeout=self.timeout)
            if resp.status_code == 429:                     # token bucket: back off and retry
                time.sleep(0.4 * (2 ** attempt))
                last = resp
                continue
            if not resp.ok:
                try:
                    payload = resp.json()
                except ValueError:
                    payload = resp.text[:400]
                raise KalshiError(resp.status_code, payload)
            return resp.json() if resp.content else {}
        raise KalshiError(last.status_code if last is not None else 0, "rate limited")

    def get(self, path: str, params: dict | None = None) -> dict:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body=body)

    def delete(self, path: str, params: dict | None = None) -> dict:
        return self._request("DELETE", path, params=params)

    @property
    def authenticated(self) -> bool:
        return bool(self.api_key_id and self._private_key is not None)

    # -- public market data -------------------------------------------------
    def exchange_status(self) -> dict:
        return self.get("/exchange/status")

    def series_list(self, category: str | None = None, tags: str | None = None,
                    limit: int = 200) -> list:
        params: dict = {"limit": limit}
        if category:
            params["category"] = category
        if tags:
            params["tags"] = tags
        return self.get("/series", params).get("series", [])

    def series(self, series_ticker: str) -> dict:
        return self.get(f"/series/{series_ticker}").get("series", {})

    def events(self, status: str = "open", limit: int = 200, cursor: str | None = None) -> dict:
        params: dict = {"status": status, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        return self.get("/events", params)

    def open_events(self, max_pages: int = 5) -> list:
        out, cursor = [], ""
        for _ in range(max_pages):
            page = self.events(cursor=cursor or None)
            out.extend(page.get("events", []))
            cursor = page.get("cursor") or ""
            if not cursor:
                break
        return out

    def markets(self, series_ticker: str | None = None, status: str = "open",
                limit: int = 200, cursor: str | None = None,
                mve_filter: str | None = "exclude") -> dict:
        params: dict = {"status": status, "limit": limit}
        if series_ticker:
            params["series_ticker"] = series_ticker
        if cursor:
            params["cursor"] = cursor
        if mve_filter:
            params["mve_filter"] = mve_filter
        return self.get("/markets", params)

    def open_markets(self, max_pages: int = 5) -> list:
        out, cursor = [], ""
        for _ in range(max_pages):
            page = self.markets(cursor=cursor or None)
            out.extend(page.get("markets", []))
            cursor = page.get("cursor") or ""
            if not cursor:
                break
        return out

    def market(self, ticker: str) -> dict:
        return self.get(f"/markets/{ticker}").get("market", {})

    def orderbook(self, ticker: str, depth: int = 0) -> dict:
        params = {"depth": depth} if depth else None
        return self.get(f"/markets/{ticker}/orderbook", params).get("orderbook_fp", {})

    def candlesticks(self, series_ticker: str, ticker: str, start_ts: int, end_ts: int,
                     period_interval: int = 1) -> list:
        if period_interval not in (1, 60, 1440):
            raise ValueError("period_interval must be 1, 60 or 1440 minutes (per Kalshi docs)")
        if (end_ts - start_ts) // 60 > 5000 * period_interval:
            raise ValueError("range exceeds the 5,000-period cap; split the request")
        return self.get(f"/series/{series_ticker}/markets/{ticker}/candlesticks",
                        {"start_ts": int(start_ts), "end_ts": int(end_ts),
                         "period_interval": period_interval}).get("candlesticks", [])

    # -- portfolio ----------------------------------------------------------
    def balance(self) -> dict:
        return self.get("/portfolio/balance")

    def positions(self, settlement_status: str = "unsettled", count_filter: str = "position") -> list:
        return self.get("/portfolio/positions", {
            "settlement_status": settlement_status,
            "count_filter": count_filter,
        }).get("market_positions", [])

    # -- orders -------------------------------------------------------------
    def place_order(self, ticker: str, side: str, price: float, count: int = 1,
                    time_in_force: str = "good_till_canceled",
                    self_trade_prevention_type: str = "taker_at_cross",
                    client_order_id: str | None = None, dry_run: bool = True) -> dict:
        """Post the documented V2 order body.

        side: "bid" buys YES, "ask" sells YES (equivalently buys NO).
        price: dollars as a string on the market's own price grid, e.g. "0.4200".
        dry_run defaults to True; set dry_run=False and KALSHI_ALLOW_ORDERS=1 to
        actually send, which is the only combination that can move demo money.
        """
        if side not in ("bid", "ask"):
            raise ValueError('side must be "bid" (buy YES) or "ask" (sell YES)')
        if not 0 < price < 1:
            raise ValueError("price must be between 0 and 1 dollars")
        body = {
            "ticker": ticker,
            "side": side,
            "count": str(int(count)),
            "price": f"{price:.4f}",
            "time_in_force": time_in_force,
            "self_trade_prevention_type": self_trade_prevention_type,
            "client_order_id": client_order_id or str(uuid.uuid4()),
        }
        if dry_run or os.environ.get("KALSHI_ALLOW_ORDERS") != "1":
            return {"dry_run": True, "request": body}
        if not self.authenticated:
            raise RuntimeError("place_order needs KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH")
        return self.post("/portfolio/events/orders", body)

    def cancel_order(self, order_id: str, market_ticker: str) -> dict:
        return self.delete(f"/portfolio/events/orders/{order_id}",
                           {"market_ticker": market_ticker})


# ---------------------------------------------------------------------------
# helpers shared with the simulation scripts
# ---------------------------------------------------------------------------
def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def last_price(market: dict) -> float:
    price = market.get("last_price_dollars")
    if price not in (None, ""):
        return _f(price)
    return _f(market.get("yes_bid_dollars"))


def dollar_volume(market: dict) -> float:
    """Contracts x price. Kalshi publishes no dollar-volume field (flag F4)."""
    return _f(market.get("volume_fp")) * last_price(market)


def spread(market: dict) -> float | None:
    bid, ask = market.get("yes_bid_dollars"), market.get("yes_ask_dollars")
    if bid in (None, "") or ask in (None, ""):
        return None
    return _f(ask) - _f(bid)


def build_topic_series(client: "KalshiClient | None" = None) -> dict[str, set[str]]:
    """Series tickers per topic, discovered from GET /series?category=&tags=.

    A series qualifies when its `categories` contains the topic category and,
    for topics narrowed by tags, one of its tags normalises to a wanted tag.
    This is the same rule the browser applies, so results match the site.
    """
    client = client or KalshiClient()
    topic_series: dict[str, set[str]] = {t: set() for t in TOPICS}
    for topic, filt in TOPIC_FILTERS.items():
        for tag in (filt["tags"] or [None]):
            try:
                series = client.series_list(category=filt["category"], tags=tag, limit=200)
            except Exception:                                  # noqa: BLE001 - skip and continue
                continue
            for s in series:
                cats = s.get("categories") or [s.get("category")]
                if filt["category"] not in cats:
                    continue
                if filt["tags"]:
                    wanted = {normalise_tag(t) for t in filt["tags"]}
                    if not ({normalise_tag(t) for t in (s.get("tags") or [])} & wanted):
                        continue
                topic_series[topic].add(s["ticker"])
    return topic_series


def classify(markets: list, events: list, topic_series: dict[str, set[str]]) -> list:
    """Attach topic + series to markets using their event's category and series ticker.

    Markets carry no category of their own; their event does, and the event also
    names the series. Combining both is what keeps a topic exact instead of fuzzy.
    """
    event_meta = {e.get("event_ticker"): e for e in events}
    out = []
    for m in markets:
        meta = event_meta.get(m.get("event_ticker"))
        if not meta:
            continue
        category = meta.get("category")
        series_ticker = meta.get("series_ticker")
        for topic, filt in TOPIC_FILTERS.items():
            if category == filt["category"] and series_ticker in topic_series.get(topic, set()):
                enriched = dict(m)
                enriched["_topic"] = topic
                enriched["_series"] = series_ticker
                enriched["_event_title"] = meta.get("title")
                enriched["_event_sub"] = meta.get("sub_title")
                out.append(enriched)
                break
    return out

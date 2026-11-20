"""Kalshi Trade API v2 client (demo + production).

Public market-data endpoints need no auth. Authenticated endpoints
(portfolio, orders, WebSocket) need an API key + RSA/Ed25519 private key.

Verified against official docs (2026-11-20):
- https://docs.kalshi.com/getting_started/api_environments
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-orderbook
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks

Never commit real keys. Load from env: KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY_PATH.
"""
from __future__ import annotations

import base64
import os
import time
from urllib.parse import urlparse

import requests

DEMO_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
PROD_BASE = "https://external-api.kalshi.com/trade-api/v2"
DEMO_WS = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2"
PROD_WS = "wss://external-api-ws.kalshi.com/trade-api/ws/v2"

# Topic -> (category, tags) discovery filters, verified via
# GET /search/tags_by_categories on 2026-11-20 (see VERIFICATION.md).
# "Culture" is a Kalshi series category (verified 2026-11-20: GET /series?category=Culture). It has no markets at capture.
TOPIC_FILTERS = {
    "gas": {"category": "Economics", "tags": ["Oil & Gas", "Oil and energy"]},
    "elections": {"category": "Elections", "tags": []},
    "culture": {"category": "Culture", "tags": []},
    "crypto": {"category": "Crypto", "tags": []},
    "golf": {"category": "Sports", "tags": ["Golf"]},
}


def _sign(private_key, timestamp: str, method: str, path: str) -> str:
    """Sign `timestamp + METHOD + path` (path without query string)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    path_no_q = path.split("?")[0]
    message = f"{timestamp}{method}{path_no_q}".encode("utf-8")
    if isinstance(private_key, Ed25519PrivateKey):
        sig = private_key.sign(message)
    else:
        sig = private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
    return base64.b64encode(sig).decode("utf-8")


class KalshiClient:
    def __init__(self, base_url: str = DEMO_BASE, api_key_id: str | None = None,
                 private_key_path: str | None = None, timeout: float = 15.0):
        self.base_url = base_url.rstrip("/")
        self.api_key_id = api_key_id or os.environ.get("KALSHI_API_KEY_ID", "")
        self.timeout = timeout
        self._private_key = None
        key_path = private_key_path or os.environ.get("KALSHI_PRIVATE_KEY_PATH", "")
        if key_path:
            from cryptography.hazmat.primitives import serialization

            with open(key_path, "rb") as f:
                self._private_key = serialization.load_pem_private_key(f.read(), password=None)

    # -- low level ---------------------------------------------------------
    def _headers(self, method: str, path: str) -> dict:
        if not self.api_key_id or self._private_key is None:
            return {}
        ts = str(int(time.time() * 1000))
        sign_path = urlparse(self.base_url + path).path
        return {
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": _sign(self._private_key, ts, method, sign_path),
        }

    def get(self, path: str, params: dict | None = None) -> dict:
        r = requests.get(self.base_url + path, params=params or {},
                         headers=self._headers("GET", path), timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, body: dict) -> dict:
        r = requests.post(self.base_url + path, json=body,
                          headers=self._headers("POST", path), timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    # -- public market data (no auth required) ------------------------------
    def exchange_status(self) -> dict:
        return self.get("/exchange/status")

    def series_list(self, category: str | None = None, tags: str | None = None,
                    limit: int = 100) -> list:
        params: dict = {"limit": limit}
        if category:
            params["category"] = category
        if tags:
            params["tags"] = tags
        return self.get("/series", params).get("series", [])

    def series(self, series_ticker: str) -> dict:
        return self.get(f"/series/{series_ticker}").get("series", {})

    def markets(self, series_ticker: str | None = None, status: str = "open",
                limit: int = 100, cursor: str | None = None) -> dict:
        params: dict = {"status": status, "limit": limit}
        if series_ticker:
            params["series_ticker"] = series_ticker
        if cursor:
            params["cursor"] = cursor
        return self.get("/markets", params)

    def market(self, ticker: str) -> dict:
        return self.get(f"/markets/{ticker}").get("market", {})

    def orderbook(self, ticker: str, depth: int = 0) -> dict:
        return self.get(f"/markets/{ticker}/orderbook", {"depth": depth}).get("orderbook_fp", {})

    def candlesticks(self, series_ticker: str, ticker: str, start_ts: int,
                     end_ts: int, period_interval: int = 1) -> list:
        return self.get(f"/series/{series_ticker}/markets/{ticker}/candlesticks",
                        {"start_ts": start_ts, "end_ts": end_ts,
                         "period_interval": period_interval}).get("candlesticks", [])

    def trades(self, ticker: str | None = None, limit: int = 100) -> list:
        params: dict = {"limit": limit}
        if ticker:
            params["ticker"] = ticker
        return self.get("/markets/trades", params).get("trades", [])

    # -- authenticated (needs demo/prod keys) --------------------------------
    def balance(self) -> dict:
        return self.get("/portfolio/balance")

    def positions(self) -> list:
        return self.get("/portfolio/positions").get("market_positions", [])

    def place_order(self, ticker: str, side: str, count: int, price_cents: int,
                    action: str = "buy") -> dict:
        """Place a limit order via the V2 endpoint.

        NOTE: Kalshi migrated orders to /portfolio/events/orders (V2).
        This helper uses the legacy-shaped body for clarity; verify the
        current V2 body shape in the OpenAPI spec before live use:
        https://docs.kalshi.com/openapi.yaml
        """
        return self.post("/portfolio/events/orders", {
            "ticker": ticker, "action": action, "side": side,
            "type": "limit", "count": count, "yes_price": price_cents,
        })


def dollar_volume(market: dict) -> float:
    """Approximate traded dollars: volume_fp (contracts) x last price.

    Kalshi returns volume as fixed-point contract counts and prices as
    dollar strings; there is no single 'dollar volume' field, so this
    documented approximation is used for ranking. See VERIFICATION.md.
    """
    try:
        vol = float(market.get("volume_fp") or 0)
    except (TypeError, ValueError):
        vol = 0.0
    try:
        px = float(market.get("last_price_dollars") or 0)
    except (TypeError, ValueError):
        px = 0.0
    return vol * px


def fetch_topic_markets(client: KalshiClient, topic: str, per_series: int = 100) -> list:
    """Fetch open markets for a topic via its verified series filters."""
    f = TOPIC_FILTERS[topic]
    out: list = []
    for tag in (f["tags"] or [None]):
        for s in client.series_list(category=f["category"], tags=tag, limit=100):
            data = client.markets(series_ticker=s["ticker"], status="open", limit=per_series)
            for m in data.get("markets", []):
                m["_series_title"] = s.get("title", "")
                m["_topic"] = topic
                out.append(m)
    # de-dupe by ticker (a series can appear under two tags)
    seen: dict = {}
    for m in out:
        seen[m["ticker"]] = m
    return sorted(seen.values(), key=dollar_volume, reverse=True)

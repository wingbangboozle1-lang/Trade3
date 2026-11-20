# Trade3 — Kalshi Demo Dashboard

Live dashboard tracking **gas prices, elections, culture, crypto and golf** on the
[Kalshi demo environment](https://docs.kalshi.com/getting_started/demo_env):
highest-dollar events, ≥ $0.10 swing alerts (two scrolling chats), price charts,
liquidity depth, resolution tracking, and simulated strategy trading.

**Live site:** GitHub Pages from `docs/` (see `.github/workflows/pages.yml`).
Open `docs/index.html` locally with any static server to preview.

## Quick start (no keys, no input)

```bash
# preview the site
python3 -m http.server 8000 --directory docs
# open http://localhost:8000/dashboard.html
```

The dashboard polls Kalshi's public REST API from your browser (demo by default).
Toggle demo/production on the dashboard page.

## Python backtest (optional)

```bash
pip install -r requirements.txt
python run_sim.py --base demo --polls 12 --interval 30 --strategy momentum
# writes sim_output.json
```

Live demo execution needs your demo API key + private key (local env only, never committed):

```bash
export KALSHI_API_KEY_ID=...            # from https://demo.kalshi.co → API Keys
export KALSHI_PRIVATE_KEY_PATH=./kalshi-key.pem
python -c "from kalshi_client import KalshiClient; print(KalshiClient().balance())"
```

## Docs

- [Executive summary](EXECUTIVE_SUMMARY.md) — requirements → implementation map
- [Verification log](VERIFICATION.md) — every claim with official source links
- [Coordination board](COORDINATION.md) — task claims, handoffs, merge record
- Site methodology: `docs/methodology.html` · Flags: `docs/flagged.html`

## Layout

```
docs/                  GitHub Pages site (index, dashboard, portfolio, topics/, methodology, flagged)
docs/assets/           style.css, app.js, dashboard.js, portfolio.js, topic.js
docs/data/series.json  verified series snapshot (2026-11-20) with API source links
kalshi_client.py       REST client + official signing (demo/prod)
strategies.py          strategy rules + high-ROI filter (explicit heuristics)
backtest.py            paper portfolio + settlement accounting
run_sim.py             live paper-trading simulation CLI
```

Not financial advice. Demo prices may not reflect real markets.

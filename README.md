# US Market Risk Dashboard

**Live:** https://market-risk-dashboard-2201.vercel.app · auto-deploys from `main`

Single-page market risk dashboard: composite **Risk-On / Risk-Off** gauge built from
the three major US indexes, VIX, BTC Fear & Greed, the full Treasury yield curve,
and gold/silver. Auto-refreshes every 60 seconds.

## How data flows

| Data | Primary source | Fallback |
|---|---|---|
| S&P 500 / Nasdaq / Dow | Yahoo Finance (via `/api/yahoo` function) | Finnhub real-time SPY / QQQ / DIA quotes |
| VIX, 10Y intraday | Yahoo Finance | — |
| Gold / Silver | Yahoo futures (GC=F / SI=F) | Twelve Data XAU/USD spot · Finnhub SLV |
| Yield curve (1M–30Y) | US Treasury official XML (direct, CORS-open) | — |
| BTC Fear & Greed | alternative.me (direct) | — |
| BTC price | CoinGecko (direct) | — |

When opened as a plain local file (no serverless backend), the page detects that
`/api/health` is absent and falls back to public CORS proxies — it still works,
just less reliably.

## Dip Radar (`/bdt/`)

A second app in this repo, inspired by the Big Dipper Trades command center (independent,
not affiliated): a dip-and-snapback scanner over a ~66-ticker universe of large caps and
sector ETFs. Dip depth is volatility-normalized (distance below the 20-day closing high in
units of each ticker's own 20-day daily volatility), mapped to a 5-state ladder
(NO DIP → EASING → DIPPING → DIP ZONE → DEEP DIP) plus a 0–100 snapback-readiness score
blending depth, RSI(14) and 5-day pullback.

- `/bdt/` — Command Center: stat tiles, sector radar, top snapback candidates
- `/bdt/watchlist.html` — full universe, filter tabs, symbol search
- `/bdt/setups.html`, `/bdt/alerts.html` — live signal trades and the alerts feed
- `/bdt/performance.html` — win rate, expectancy, profit factor, equity curve, per-ticker table
- Signal engine (`api/scan.mjs`): fires a BUY when IN ZONE + BREAKOUT + UPTURN + STRONG BAR
  all hold on a completed 30-min bar, with volatility-scaled target/stop and earned T1–T5 tiers.
  State (open trades, closed log, alerts) lives in a private Vercel Blob store.
- `/api/backtest` seeds win-rate history (`?reset=1&since=YYYY-MM-DD` to re-seed a window).
- The standalone Vercel project for Dip Radar uses `bdt/` as its Root Directory
  (`bdt/api/` + `bdt/package.json`); the copies under root `api/` serve the same app from this site.
- **Where the signal engine actually runs:** only the standalone `dip-radar` project
  (https://dip-radar-zeta.vercel.app) has a Blob store connected, so open trades, alerts and the
  Performance page only work there. The hub's header links to it. This site's own `/bdt/` copy has
  no Blob store: the Command Center and Watchlist still score dips, but `/api/scan`, `/api/backtest`
  return 503 and Setups / Alerts / Performance show "storage is not connected". The `dip-radar`
  project has Vercel SSO on, so you must be signed in to Vercel to open it.

## Deploy (Vercel + GitHub)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** this repo. Framework preset **Other**,
   no build command; the `api/` functions and static files deploy as-is.
3. In **Project Settings → Environment Variables**, add:
   - `FINNHUB_KEY` — your Finnhub API key
   - `TWELVEDATA_KEY` — your Twelve Data API key
4. Deploy. The footer should read "⚡ Serverless mode".

Keys are only read server-side inside the functions in `api/` —
they are never committed to the repo and never sent to the browser.

> Informational only — not financial advice.

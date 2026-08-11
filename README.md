# US Market Risk Dashboard

**Live:** deployed on Vercel · auto-deploys from `main`

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

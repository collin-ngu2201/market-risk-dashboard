# US Market Risk Dashboard

**Live:** https://market-risk-dashboard.netlify.app · auto-deploys from `main`

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

When opened as a plain local file (no Netlify), the page detects that `/api/health`
is absent and falls back to public CORS proxies — it still works, just less reliably.

## Dip Radar (`/bdt/`)

A second app in this repo, inspired by the Big Dipper Trades command center (independent,
not affiliated): a dip-and-snapback scanner over a ~66-ticker universe of large caps and
sector ETFs. Dip depth is volatility-normalized (distance below the 20-day closing high in
units of each ticker's own 20-day daily volatility), mapped to a 5-state ladder
(NO DIP → EASING → DIPPING → DIP ZONE → DEEP DIP) plus a 0–100 snapback-readiness score
blending depth, RSI(14) and 5-day pullback.

- `/bdt/` — Command Center: stat tiles, 12-sector radar, top snapback candidates
- `/bdt/watchlist.html` — full universe, filter tabs, symbol search
- Data: `/api/bdt` batch function (Yahoo chart API server-side, allowlisted symbols,
  4 requests per scan); falls back to public CORS proxies when opened without Netlify.
- Phase 2 (planned): scheduled scanner + Netlify Blobs for fired signals with
  entry/target/stop tracking, alerts feed, earned T1–T5 tiers and win-rate stats.

## Deploy (Vercel + GitHub)

The `api/` directory holds the canonical serverless functions (Vercel Web-handler
signature, file-based routing: `api/bdt.mjs` → `/api/bdt`). Import the repo at
vercel.com/new (framework preset: Other, no build command) or deploy via CLI with
`vercel --prod`. Set `FINNHUB_KEY` and `TWELVEDATA_KEY` in the project's
Environment Variables to arm the keyed fallbacks — everything else works without keys.

## Deploy (Netlify + GitHub) — legacy

`netlify/functions/` mirrors the same functions for the original Netlify setup.

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub** → pick this repo.
   No build command needed; publish directory is the repo root (set in `netlify.toml`).
3. In **Site configuration → Environment variables**, add:
   - `FINNHUB_KEY` — your Finnhub API key
   - `TWELVEDATA_KEY` — your Twelve Data API key
4. Redeploy. The footer should read "⚡ Serverless mode".

Keys are only read server-side inside the functions in `netlify/functions/` —
they are never committed to the repo and never sent to the browser.

> Informational only — not financial advice.

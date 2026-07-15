// Shared server-side code for the Dip Radar functions (files prefixed with
// "_" inside api/ are not exposed as routes by Vercel).
// Universe allowlist, Yahoo chart fetch, indicators, dip math, trade rules.
import { list } from "@vercel/blob";

export const UNIVERSE = new Set([
  // sector radar ETFs
  "SPY", "QQQ", "XLV", "XLC", "KRE", "ARKK", "ITB", "JETS", "XOP", "USO", "UFO", "NASA",
  // other ETFs
  "IWM", "GLD", "SLV", "GDX", "XLE", "XLF", "XLU", "XLB", "XLI", "XLK",
  // stocks
  "AAPL", "AMD", "AMZN", "ARM", "ASTS", "AVGO", "BAC", "CAT", "COST", "CSCO",
  "F", "GE", "GM", "GS", "HOOD", "INTC", "IONQ", "JPM", "KO", "KTOS",
  "LUNR", "MCD", "META", "MU", "NVDA", "ORCL", "PFE", "PGR", "RBLX", "RDW",
  "RKLB", "RTX", "SHOP", "SOFI", "TSLA", "UBER", "V", "WFC", "WMT", "ZM",
  // leveraged
  "SOXL", "SPXL", "TSLL", "GGLL",
]);
export const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y"]);
export const INTERVALS = new Set(["5m", "15m", "30m", "1h", "1d", "1wk"]);

export const r4 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 10000) / 10000);

// Blob stores connected with a custom env prefix expose e.g.
// MYSTORE_READ_WRITE_TOKEN instead of BLOB_READ_WRITE_TOKEN — accept any.
export const blobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env[Object.keys(process.env).find((k) => k.endsWith("_READ_WRITE_TOKEN")) || ""] ||
  null;

// The Dip Radar store is a PRIVATE blob store, so its blob URLs are not
// publicly fetchable — reads must carry the token as a Bearer header
// (per Vercel's private-storage docs). Writes use access: "private".
export const BLOB_ACCESS = "private";
export async function readBlobJson(prefix) {
  const token = blobToken();
  if (!token) return null;
  const { blobs } = await list({ prefix, limit: 1, token });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, {
    headers: { authorization: "Bearer " + token }, cache: "no-store",
  });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

// One Yahoo v8 chart call -> compact series {t,c,h,l,price,prevClose,...}
export async function fetchOne(symbol, range, interval) {
  const upstream =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`;
  const r = await fetch(upstream, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!r.ok) throw new Error("upstream " + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error("bad payload");
  const meta = res.meta || {};
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const t = [], c = [], h = [], l = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    t.push(ts[i]);
    c.push(r4(q.close[i]));
    h.push(r4(q.high?.[i] ?? q.close[i]));
    l.push(r4(q.low?.[i] ?? q.close[i]));
  }
  return {
    t, c, h, l,
    price: r4(meta.regularMarketPrice),
    prevClose: r4(meta.chartPreviousClose ?? meta.previousClose),
    hi52: r4(meta.fiftyTwoWeekHigh),
    lo52: r4(meta.fiftyTwoWeekLow),
    name: meta.shortName || meta.longName || null,
    mktTime: meta.regularMarketTime || null,
  };
}

/* ---------------- indicators & dip math (mirrors bdt.js client) ------- */
export function stdev(a) {
  if (a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
export function rsi14(closes) {
  if (closes.length < 15) return null;
  const c = closes.slice(-60);
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / 14, al = l / 14;
  for (let i = 15; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * 13 + (d > 0 ? d : 0)) / 14;
    al = (al * 13 + (d < 0 ? -d : 0)) / 14;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
// Daily analysis: dip depth d in units of the ticker's own 20-day volatility.
export function dailyDip(q) {
  if (!q || q.error || !q.c || q.c.length < 25) return null;
  const c = q.c, n = c.length;
  const last = q.price ?? c[n - 1];
  const high20 = Math.max(...c.slice(-20), last);
  const rets = [];
  for (let i = Math.max(1, n - 20); i < n; i++) rets.push((c[i] / c[i - 1] - 1) * 100);
  const vol20 = Math.max(stdev(rets) ?? 1, 0.35);
  const offHigh = (last / high20 - 1) * 100;
  const d = -offHigh / vol20;
  return { last, d, vol20, offHigh };
}

/* ---------------- signal rules (documented defaults) -------------------
   Fire a BUY when, on the latest completed 30-min bar, all four hold:
     IN ZONE    daily dip depth d >= 1.75 (buy-signal territory)
     BREAKOUT   bar close > previous bar's high
     UPTURN     RSI14 on 30-min closes is rising vs 2 bars earlier
     STRONG BAR close sits in the upper 60% of the bar's range
   Exits are volatility-scaled off the DAILY vol so calm ETFs get tight
   brackets and leveraged funds get wide ones:
     take-profit = entry * (1 + 3.0 * vol20%)   clamped to +1.2% .. +8%
     stop-loss   = entry * (1 - 7.5 * vol20%)   clamped to -3%  .. -15%
   Long only. One open trade per ticker. No re-fire on a ticker the same
   ET day it already closed a trade. If a bar spans both levels, the stop
   wins (conservative). */
export const ENGINE = {
  zoneDepth: 1.75,
  strongBarPos: 0.6,
  tpVolMult: 3.0, tpMinPct: 1.2, tpMaxPct: 8,
  slVolMult: 7.5, slMinPct: 3, slMaxPct: 15,
};
export function bracketFor(entry, vol20) {
  const tpPct = Math.min(Math.max(ENGINE.tpVolMult * vol20, ENGINE.tpMinPct), ENGINE.tpMaxPct);
  const slPct = Math.min(Math.max(ENGINE.slVolMult * vol20, ENGINE.slMinPct), ENGINE.slMaxPct);
  return { tp: r4(entry * (1 + tpPct / 100)), sl: r4(entry * (1 - slPct / 100)) };
}
// Evaluate the 4 BD-engine conditions on 30-min bars (uses the last
// COMPLETED bar: the final bar of an in-progress session may still be forming,
// so we look at bars[n-2] vs bars[n-3] when the market is open).
export function evalEngine(bars30, dip, marketOpen) {
  const n = bars30?.c?.length ?? 0;
  if (n < 20 || !dip) return null;
  const i = marketOpen ? n - 2 : n - 1;   // last completed bar
  if (i < 1) return null;
  const close = bars30.c[i], high = bars30.h[i], low = bars30.l[i];
  const prevHigh = bars30.h[i - 1];
  const rsiNow = rsi14(bars30.c.slice(0, i + 1));
  const rsiPrev = rsi14(bars30.c.slice(0, i - 1));
  const range = Math.max(high - low, 1e-9);
  const conds = {
    inZone: dip.d >= ENGINE.zoneDepth,
    breakout: close > prevHigh,
    upturn: rsiNow != null && rsiPrev != null && rsiNow > rsiPrev,
    strongBar: (close - low) / range >= ENGINE.strongBarPos,
  };
  return { conds, all: Object.values(conds).every(Boolean), barClose: close, barTime: bars30.t[i] };
}

/* ---------------- market clock ---------------- */
export function etParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(date).map((x) => [x.type, x.value]));
}
export function isMarketOpen(date = new Date()) {
  const p = etParts(date);
  const mins = (+p.hour) * 60 + (+p.minute);
  return !["Sat", "Sun"].includes(p.weekday) && mins >= 570 && mins < 960;
}
export const etDay = (date = new Date()) => {
  const p = etParts(date);
  return `${p.year}-${p.month}-${p.day}`;
};

/* ---------------- historical backtest (seeds win rates) ----------------
   Yahoo only serves ~60 days of 30-min bars, too short to backtest, so the
   seed runs a DAILY-bar mirror of the engine over a long window. It reads
   the dip context from the PRIOR close (stock already in a dip) and uses the
   current day as the breakout trigger, matching the live "in a dip, then a
   strong breakout bar" logic — just at daily resolution. Exits use the same
   volatility-scaled brackets; a 15-bar time-stop closes anything that never
   reaches a level (result by sign). One open trade per ticker at a time.
   Trades are tagged bt:1 so the UI can tell seeded from live trades. */
export function backtestDaily(q, sym, { maxHold = 15, capPerSym = 10 } = {}) {
  const c = q?.c, h = q?.h, l = q?.l, t = q?.t;
  if (!c || c.length < 60) return [];
  const trades = [];
  let open = null;
  for (let i = 24; i < c.length; i++) {
    if (open) {
      let done = null;
      if (l[i] <= open.sl) done = { exit: open.sl, result: "loss" };          // stop wins ties
      else if (h[i] >= open.tp) done = { exit: open.tp, result: "win" };
      else if (i - open.idx >= maxHold) done = { exit: c[i], result: c[i] >= open.entry ? "win" : "loss" };
      if (done) {
        trades.push({
          sym, bt: 1, entry: open.entry, tp: open.tp, sl: open.sl, vol20: open.vol20,
          firedAt: open.firedAt, closedAt: t[i] * 1000, exit: r4(done.exit),
          result: done.result, pct: r4((done.exit / open.entry - 1) * 100),
        });
        open = null;
      }
      continue;                                                                 // no same-day re-entry
    }
    // dip context as of the prior close
    const prevSlice = c.slice(i - 20, i);
    if (prevSlice.length < 20) continue;
    const rets = [];
    for (let k = i - 19; k < i; k++) rets.push((c[k] / c[k - 1] - 1) * 100);
    const vol20 = Math.max(stdev(rets) ?? 1, 0.35);
    const high20 = Math.max(...prevSlice);
    const d = -((c[i - 1] / high20 - 1) * 100) / vol20;
    const range = Math.max(h[i] - l[i], 1e-9);
    const rsiNow = rsi14(c.slice(0, i + 1)), rsiPrev = rsi14(c.slice(0, i - 1));
    if (d >= ENGINE.zoneDepth && c[i] > h[i - 1] &&
        (c[i] - l[i]) / range >= ENGINE.strongBarPos &&
        rsiNow != null && rsiPrev != null && rsiNow > rsiPrev) {
      const entry = r4(c[i]);
      const { tp, sl } = bracketFor(entry, vol20);
      open = { entry, tp, sl, vol20: r4(vol20), idx: i, firedAt: t[i] * 1000 };
    }
  }
  return trades.slice(-capPerSym);
}

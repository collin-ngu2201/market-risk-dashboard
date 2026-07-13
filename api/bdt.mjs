// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
// Batch server-side proxy for Yahoo Finance v8 chart API, for the /bdt/ pages.
// Fans out to one chart call per symbol and returns a compact combined payload,
// so the browser loads the whole ~66-ticker universe in 4 requests.
// Allowlisted symbols only, so this can't be abused as an open proxy.
const UNIVERSE = new Set([
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
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y"]);
const INTERVALS = new Set(["5m", "15m", "30m", "1h", "1d", "1wk"]);
const MAX_BATCH = 20;

const r4 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 10000) / 10000);

async function fetchOne(symbol, range, interval) {
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

export default async (req) => {
  const u = new URL(req.url, "http://localhost");
  const symbols = (u.searchParams.get("symbols") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length || symbols.length > MAX_BATCH)
    return Response.json({ error: `1-${MAX_BATCH} symbols required` }, { status: 400 });
  const bad = symbols.filter((s) => !UNIVERSE.has(s));
  if (bad.length)
    return Response.json({ error: "symbol not allowed: " + bad.join(",") }, { status: 400 });
  const range = RANGES.has(u.searchParams.get("range")) ? u.searchParams.get("range") : "6mo";
  const interval = INTERVALS.has(u.searchParams.get("interval")) ? u.searchParams.get("interval") : "1d";

  const out = {};
  await Promise.all(symbols.map(async (s) => {
    try { out[s] = await fetchOne(s, range, interval); }
    catch (e) { out[s] = { error: String(e.message || e) }; }
  }));
  return Response.json(out, {
    headers: { "cache-control": "public, max-age=60" },
  });
};


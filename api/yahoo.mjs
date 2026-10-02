// Server-side proxy for Yahoo Finance v8 chart API (no CORS in browsers).
// Allowlisted symbols only, so this can't be abused as an open proxy.
const ALLOWED = new Set([
  "^GSPC", "^IXIC", "^DJI", "^VIX",
  "GC=F", "SI=F",
  "^TNX", "^TYX", "^FVX", "^IRX",
  "BTC-USD",
]);
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y"]);
const INTERVALS = new Set(["5m", "15m", "1h", "1d", "1wk"]);

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || "");
  if (!ALLOWED.has(symbol)) { res.status(400).json({ error: "symbol not allowed" }); return; }
  const range = RANGES.has(req.query?.range) ? req.query.range : "3mo";
  const interval = INTERVALS.has(req.query?.interval) ? req.query.interval : "1d";

  const upstream =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`;
  const r = await fetch(upstream, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!r.ok) { res.status(502).json({ error: "upstream " + r.status }); return; }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=30");
  res.status(200).send(await r.text());
}
